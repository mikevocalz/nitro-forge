import {AppRegistry} from 'react-native';
import {PhotoDevelopDemo} from '../../../examples/native-instruments/PhotoDevelopDemo.tsx';
const params=new URLSearchParams(location.search);
AppRegistry.registerComponent('PhotoDevelopDemo',()=>()=> <PhotoDevelopDemo invalid={params.has('invalid')} deferred={params.has('deferred')}/>);
AppRegistry.runApplication('PhotoDevelopDemo',{rootTag:document.getElementById('root')});
