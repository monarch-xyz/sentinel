# Railway Config As Code

These files define the Railway build/deploy settings for each app service in this repo.

Use the following custom config paths in Railway service settings:

- `api` -> `/deploy/railway/api/railway.json`
- `worker` -> `/deploy/railway/worker/railway.json`
- `delivery` -> `/deploy/railway/delivery/railway.json`

Important limits from Railway's config-as-code model:

- config-as-code only controls build/deploy settings
- it does not create services, databases, domains, or environment variables
- it does not set the service root directory

Service root directories you should still set manually:

- `api` -> `/`
- `worker` -> `/`
- `delivery` -> `/packages/delivery`

Why `delivery` still needs a manual root directory:

- the delivery service uses its own package-local `Dockerfile`
- Railway config files do not inherit the service root directory automatically
- this repo's current delivery `Dockerfile` expects `/packages/delivery` to be the source root

After linking the config file path, still set:

- service environment variables
- public domains
- private networking references
- database/redis variable references

Railway docs used:

- config as code: https://docs.railway.com/config-as-code/reference
- custom config file path: https://docs.railway.com/deploy/config-as-code
- monorepo/root directory note: https://docs.railway.com/deployments/monorepo
- build configuration note about config path vs root directory: https://docs.railway.com/builds/build-configuration
