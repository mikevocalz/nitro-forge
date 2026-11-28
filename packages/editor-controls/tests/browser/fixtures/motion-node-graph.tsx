import {AppRegistry} from 'react-native';
import {MotionNodeGraphDemo} from '../../../examples/native-instruments/MotionNodeGraphDemo.tsx';
AppRegistry.registerComponent('MotionNodeGraphDemo',()=>MotionNodeGraphDemo);
AppRegistry.runApplication('MotionNodeGraphDemo',{rootTag:document.getElementById('root')});
