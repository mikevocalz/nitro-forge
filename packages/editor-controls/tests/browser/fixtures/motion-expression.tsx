import {AppRegistry} from 'react-native';
import {MotionExpressionDemo} from '../../../examples/native-instruments/MotionExpressionDemo.tsx';
AppRegistry.registerComponent('MotionExpressionDemo',()=>MotionExpressionDemo);
AppRegistry.runApplication('MotionExpressionDemo',{rootTag:document.getElementById('root')});
