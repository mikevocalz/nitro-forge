import {AppRegistry} from 'react-native';
import {MotionSettingsDemo} from '../../../examples/native-instruments/MotionSettingsDemo.tsx';
AppRegistry.registerComponent('MotionSettingsDemo',()=>MotionSettingsDemo);
AppRegistry.runApplication('MotionSettingsDemo',{rootTag:document.getElementById('root')});
