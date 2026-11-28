import {AppRegistry} from 'react-native';
import {MotionPathDemo} from '../../../examples/native-instruments/MotionPathDemo.tsx';
AppRegistry.registerComponent('MotionPathDemo',()=>MotionPathDemo);
AppRegistry.runApplication('MotionPathDemo',{rootTag:document.getElementById('root')});
