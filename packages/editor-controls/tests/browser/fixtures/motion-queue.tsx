import {AppRegistry} from 'react-native';
import {MotionQueueDemo} from '../../../examples/native-instruments/MotionQueueDemo.tsx';
const params=new URLSearchParams(location.search);
AppRegistry.registerComponent('MotionQueueDemo',()=>()=> <MotionQueueDemo deferred={params.has('deferred')} spring={params.has('spring')}/>);
AppRegistry.runApplication('MotionQueueDemo',{rootTag:document.getElementById('root')});
