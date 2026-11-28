import {AppRegistry} from 'react-native';
import {MultiSelectionDemo} from '../../../examples/native-instruments/MultiSelectionDemo.tsx';
document.body.style.margin='0';document.documentElement.dir=new URLSearchParams(location.search).get('dir')??'ltr';AppRegistry.registerComponent('multi-selection',()=>MultiSelectionDemo);AppRegistry.runApplication('multi-selection',{rootTag:document.getElementById('root')});
