import {AppRegistry} from 'react-native';
import {LayerBlendDemo} from '../../../examples/native-instruments/LayerBlendDemo.tsx';
document.body.style.margin='0';document.documentElement.dir=new URLSearchParams(location.search).get('dir')??'ltr';AppRegistry.registerComponent('layer-blend',()=>LayerBlendDemo);AppRegistry.runApplication('layer-blend',{rootTag:document.getElementById('root')});
