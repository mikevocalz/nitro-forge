// This app imports Board's portable offline subpaths. Its optional XR renderer
// requires a Viro host and is not part of this storage/runtime acceptance lane.
module.exports = {
  dependencies: {
    "@nitro-forge/board": { platforms: { android: null, ios: null } },
    "@reactvision/react-viro": { platforms: { android: null, ios: null } },
  },
};
