#include <node_api.h>
#include <CoreFoundation/CoreFoundation.h>
#include <xpc/xpc.h>
#include <mach-o/dyld.h>
#include <crt_externs.h>
#include <unistd.h>
#include <limits.h>
#include <string>
#include <vector>

static const char *service = "com.automicvault.av2.approval";
static const char *requirement = "anchor apple generic and certificate leaf[subject.OU] = ZU76A67LGU and identifier \"com.automicvault\"";
static const std::string target = [] {
  char executable[PATH_MAX], resolved[PATH_MAX];
  uint32_t size = sizeof(executable);
  if (_NSGetExecutablePath(executable, &size) != 0 || !realpath(executable, resolved)) return std::string();
  return std::string(resolved);
}();
static const std::vector<std::string> arguments = [] {
  std::vector<std::string> result;
  for (int i = 1; i < *_NSGetArgc(); i++) result.emplace_back((*_NSGetArgv())[i]);
  return result;
}();

static bool validUTF8(const std::string &value) {
  CFStringRef string = CFStringCreateWithBytes(kCFAllocatorDefault,
    reinterpret_cast<const UInt8 *>(value.data()), value.size(), kCFStringEncodingUTF8, false);
  if (!string) return false;
  CFRelease(string);
  return true;
}

static napi_value fail(napi_env env, const char *message) {
  napi_throw_error(env, nullptr, message);
  return nullptr;
}

static bool text(napi_env env, napi_value value, std::string &out) {
  size_t length = 0;
  if (napi_get_value_string_utf8(env, value, nullptr, 0, &length) != napi_ok || length > 1024 * 1024) return false;
  std::vector<char> bytes(length + 1);
  if (napi_get_value_string_utf8(env, value, bytes.data(), bytes.size(), &length) != napi_ok) return false;
  out.assign(bytes.data(), length);
  return out.find('\0') == std::string::npos;
}

static napi_value request(napi_env env, napi_callback_info info) {
  size_t count = 3;
  napi_value values[3];
  if (napi_get_cb_info(env, info, &count, values, nullptr, nullptr) != napi_ok || count < 2) return fail(env, "Invalid Automic Vault request");
  std::string operation, key, value;
  if (!text(env, values[0], operation) || !text(env, values[1], key)) return fail(env, "Invalid Automic Vault request");
  const std::string prefix = "WRANGLER_AUTH_";
  if ((operation != "keys" && operation != "wrangler-save" && operation != "wrangler-delete") ||
      key.compare(0, prefix.size(), prefix) != 0 || key.size() <= prefix.size() || key.size() > 512 ||
      (key.size() - prefix.size()) % 2 != 0 || key.find_first_not_of("0123456789ABCDEF", prefix.size()) != std::string::npos) return fail(env, "Invalid Wrangler Secret Name");
  if (operation == "wrangler-save" && (count != 3 || !text(env, values[2], value))) return fail(env, "Invalid Wrangler credential");
  char cwd[PATH_MAX];
  if (!getcwd(cwd, sizeof(cwd)) || !validUTF8(cwd)) return fail(env, "Cannot resolve working directory");
  for (const auto &arg : arguments) if (!validUTF8(arg)) return fail(env, "Wrangler arguments must be UTF-8");
  xpc_object_t message = xpc_dictionary_create_empty();
  xpc_dictionary_set_string(message, "op", operation.c_str());
  xpc_dictionary_set_string(message, "key", key.c_str());
  if (operation == "wrangler-save") xpc_dictionary_set_string(message, "value", value.c_str());
  if (operation == "keys") {
    xpc_dictionary_set_string(message, "target", target.c_str());
    xpc_dictionary_set_string(message, "cwd", cwd);
    xpc_dictionary_set_string(message, "tool", "wrangler");
    xpc_dictionary_set_string(message, "title", "Wrangler credential requested");
    xpc_dictionary_set_string(message, "detail", "Wrangler needs its OAuth credential for this operation.");
    xpc_dictionary_set_bool(message, "replace_existing_env", true);
    xpc_dictionary_set_bool(message, "allow_missing_keys", false);
    xpc_object_t keys = xpc_array_create_empty();
    xpc_array_set_string(keys, XPC_ARRAY_APPEND, key.c_str());
    xpc_dictionary_set_value(message, "keys", keys);
    xpc_release(keys);
    xpc_object_t args = xpc_array_create_empty();
    for (const auto &arg : arguments) xpc_array_set_string(args, XPC_ARRAY_APPEND, arg.c_str());
    xpc_dictionary_set_value(message, "args", args);
    xpc_release(args);
    xpc_object_t conflicts = xpc_array_create_empty();
    xpc_dictionary_set_value(message, "env_conflicts", conflicts);
    xpc_release(conflicts);
  }
  xpc_connection_t connection = xpc_connection_create_mach_service(service, nullptr, 0);
  if (!connection || xpc_connection_set_peer_code_signing_requirement(connection, requirement) != 0) {
    if (connection) xpc_release(connection);
    xpc_release(message);
    return fail(env, "Cannot authenticate Automic Vault approval service");
  }
  xpc_connection_set_event_handler(connection, ^(xpc_object_t event) {
    if (xpc_get_type(event) != XPC_TYPE_DICTIONARY) return;
    const char *name = xpc_dictionary_get_string(event, "event");
    if (name && strcmp(name, "human-approval-required") == 0) fputs("automic vault: human approval required\n", stderr);
  });
  xpc_connection_activate(connection);
  xpc_object_t reply = xpc_connection_send_message_with_reply_sync(connection, message);
  xpc_release(message);
  xpc_connection_cancel(connection);
  xpc_release(connection);
  if (!reply || xpc_get_type(reply) != XPC_TYPE_DICTIONARY) {
    if (reply) xpc_release(reply);
    return fail(env, "Automic Vault approval service is unavailable");
  }
  napi_value result;
  napi_get_undefined(env, &result);
  if (!xpc_dictionary_get_bool(reply, "ok")) {
    const char *error = xpc_dictionary_get_string(reply, "error");
    std::string reason = error ? error : "Automic Vault request denied";
    xpc_release(reply);
    // Only an explicit missing item means logged out. Denial never starts login.
    if (operation == "keys" && reason == "failed to load secret " + key + ": -25300") return result;
    return fail(env, reason.c_str());
  }
  if (operation == "keys") {
    xpc_object_t secrets = xpc_dictionary_get_value(reply, "secrets");
    if (!secrets || xpc_get_type(secrets) != XPC_TYPE_DICTIONARY) {
      xpc_release(reply);
      return fail(env, "Invalid Automic Vault credential reply");
    }
    const char *secret = xpc_dictionary_get_string(secrets, key.c_str());
    if (!secret) {
      xpc_release(reply);
      return fail(env, "Automic Vault credential reply omitted the requested Secret");
    }
    napi_create_string_utf8(env, secret, NAPI_AUTO_LENGTH, &result);
  }
  xpc_release(reply);
  return result;
}

static napi_value init(napi_env env, napi_value exports) {
  if (target.empty() || !validUTF8(target)) return fail(env, "Cannot resolve Wrangler Target");
  napi_value function;
  if (napi_create_function(env, "request", NAPI_AUTO_LENGTH, request, nullptr, &function) != napi_ok ||
      napi_set_named_property(env, exports, "request", function) != napi_ok) return fail(env, "Cannot initialize Automic Vault client");
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
