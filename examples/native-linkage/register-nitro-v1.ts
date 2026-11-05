/**
 * Called before registering the Cadence React component.
 * Imports the real generated factory, not the Nitro 0.x HybridObject.
 */
import { ForgeFactory } from "@nitro-forge/ignition-v1-lab";
import { registerForgeV1Factory } from "@nitro-forge/ignition/v1-host";

registerForgeV1Factory(new ForgeFactory());
