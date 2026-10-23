// Exercise the production N-API request builder without contacting Secret Custody.
#include <xpc/xpc.h>
#include <string>

static xpc_object_t captureRequest(xpc_connection_t, xpc_object_t message) {
  const char *cwd = xpc_dictionary_get_string(message, "cwd");
  std::string result = cwd ? std::string("captured cwd: ") + cwd
                          : "secret mutation is missing its working directory";
  if (xpc_dictionary_get_value(message, "project_directory")) {
    result = "unexpected Project Value mutation";
  }
  xpc_object_t reply = xpc_dictionary_create_empty();
  xpc_dictionary_set_bool(reply, "ok", false);
  xpc_dictionary_set_string(reply, "error", result.c_str());
  return reply;
}

#define xpc_connection_create_mach_service(...) reinterpret_cast<xpc_connection_t>(xpc_dictionary_create_empty())
#define xpc_connection_set_peer_code_signing_requirement(...) 0
#define xpc_connection_set_event_handler(...) ((void)0)
#define xpc_connection_activate(...) ((void)0)
#define xpc_connection_cancel(...) ((void)0)
#define xpc_connection_send_message_with_reply_sync captureRequest
#include "automic-vault.cc"
