import {AppRegistry} from 'react-native';
import {LoadSkiaWeb} from 'react-native-skia/lib/module/web';
// Load the actual CanvasKit WASM before evaluating the renderer's module.
void LoadSkiaWeb({locateFile:file=>'/skia/'+file}).then(async()=>{const {GpuCanvasDemo}=await import('../../../examples/native-instruments/GpuCanvasDemo.tsx');AppRegistry.registerComponent('gpu-canvas',()=>GpuCanvasDemo);AppRegistry.runApplication('gpu-canvas',{rootTag:document.getElementById('root')});}).catch(error=>{console.error(error);throw error;});
