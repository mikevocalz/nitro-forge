import {AppRegistry} from 'react-native';
import {MotionCurvesDemo} from '../../../examples/native-instruments/MotionCurvesDemo.tsx';
AppRegistry.registerComponent('MotionCurvesDemo',()=>MotionCurvesDemo);
AppRegistry.runApplication('MotionCurvesDemo',{rootTag:document.getElementById('root')});
