import { createNitroHost } from "@nitro-forge/ignition";
import { SceneDocument } from "@nitro-forge/scene";

const host = createNitroHost();
const scene = await SceneDocument.open(host, "Demo");
const material = (await scene.addMaterial()).data.material_id; // meshes need a material
const cube = (await scene.addMeshPrimitive({ kind: "box", size: [2, 2, 2], material })).data.mesh_id;
const node = (await scene.addNode({ kind: "mesh", mesh: cube, name: "Cube" })).data.node_id;

const bytes = await scene.save(); // NFD1 snapshot
await scene.close();

const reopened = await SceneDocument.openSnapshot(host, bytes);
const maxX = async () => (await reopened.bounds()).data.bounds?.max[0];
console.log(await maxX()); // 1
await reopened.setTransform(node, { translation: [5, 0, 0] });
await reopened.undo();
console.log(await maxX()); // 1
await reopened.redo();
console.log(await maxX()); // 6

const hit = await reopened.pick([5, 0, 10], [0, 0, -1]); // ray from +Z toward the cube
console.log(hit.data.hit !== null); // true
await reopened.close();
await host.dispose();
