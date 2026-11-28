import {AppRegistry} from 'react-native';
import {PhotoMasksDemo} from '../../../examples/native-instruments/PhotoMasksDemo.tsx';
const params=new URLSearchParams(location.search);
AppRegistry.registerComponent('PhotoMasksDemo',()=>()=> <PhotoMasksDemo deferred={params.has('deferred')}/>);
AppRegistry.runApplication('PhotoMasksDemo',{rootTag:document.getElementById('root')});
