/**
 * Vitest/Vite resolve settings that read the workspace packages from source.
 *
 * Public packages export built `lib/` files by default. Each export also
 * carries a leading `@nitro-forge/source` condition that points at `src/`, so
 * tests, typechecks and the monorepo apps run without `turbo run build`.
 * Nothing outside this repo sets that condition, so release tarballs always
 * resolve to `lib/`.
 *
 * The lists repeat Vite's defaults after the source condition, because
 * setting `conditions` replaces them. Node tests resolve through `ssr`.
 */
export const SOURCE_CONDITION = "@nitro-forge/source";

const server = [SOURCE_CONDITION, "module", "node", "development|production"];
const client = [SOURCE_CONDITION, "module", "browser", "development|production"];

export const sourceResolve = {
  resolve: { conditions: client },
  ssr: { resolve: { conditions: server, externalConditions: [SOURCE_CONDITION, "node"] } },
};

export default sourceResolve;
