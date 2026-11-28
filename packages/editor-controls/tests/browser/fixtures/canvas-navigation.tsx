import {AppRegistry} from 'react-native';
import {CanvasNavigationDemo} from '../../../examples/native-instruments/CanvasNavigationDemo.tsx';
const params=new URLSearchParams(location.search);document.body.style.margin='0';document.documentElement.dir=params.get('dir')??'ltr';document.documentElement.dataset.theme='light';
AppRegistry.registerComponent('canvas-navigation',()=>()=> <CanvasNavigationDemo occluded={params.get('hinge')==='1'}/>);AppRegistry.runApplication('canvas-navigation',{rootTag:document.getElementById('root')});
