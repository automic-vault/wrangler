using Workerd = import "/workerd/workerd.capnp";
const config :Workerd.Config = (
  services = [(name = "main", worker = (
    modules = [(name = "worker", esModule = "export default { test() { if (1 + 1 !== 2) throw new Error('failed'); } };" )],
    compatibilityDate = "2024-01-01"
  ))]
);
