import {AppRegistry} from 'react-native';
import {PhotoWorkflowDemo} from '../../../examples/native-instruments/PhotoWorkflowDemo.tsx';
const params=new URLSearchParams(location.search);
AppRegistry.registerComponent('PhotoWorkflowDemo',()=>()=> <PhotoWorkflowDemo invalid={params.has('invalid')} deferred={params.has('deferred')}/>);
AppRegistry.runApplication('PhotoWorkflowDemo',{rootTag:document.getElementById('root')});
