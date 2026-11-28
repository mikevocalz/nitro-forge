import {AppRegistry} from 'react-native';
import {LayerTreeDemo} from '../../../examples/native-instruments/LayerTreeDemo.tsx';
document.body.style.margin='0';document.documentElement.dir=new URLSearchParams(location.search).get('dir')??'ltr';AppRegistry.registerComponent('layer-tree',()=>LayerTreeDemo);AppRegistry.runApplication('layer-tree',{rootTag:document.getElementById('root')});
