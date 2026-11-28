import {AppRegistry} from 'react-native';
import {CompositionTreeDemo} from '../../../examples/native-instruments/CompositionTreeDemo.tsx';
AppRegistry.registerComponent('CompositionTreeDemo',()=>CompositionTreeDemo);
AppRegistry.runApplication('CompositionTreeDemo',{rootTag:document.getElementById('root')});
