import {AppRegistry} from 'react-native';
import {MotionTimelineDemo} from '../../../examples/native-instruments/MotionTimelineDemo.tsx';
AppRegistry.registerComponent('MotionTimelineDemo',()=>MotionTimelineDemo);
AppRegistry.runApplication('MotionTimelineDemo',{rootTag:document.getElementById('root')});
