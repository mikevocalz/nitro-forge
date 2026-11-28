import {AppRegistry} from 'react-native';
import {ArtboardDemo} from '../../../examples/native-instruments/ArtboardDemo.tsx';
document.body.style.margin='0';document.documentElement.dir=new URLSearchParams(location.search).get('dir')??'ltr';AppRegistry.registerComponent('artboard',()=>ArtboardDemo);AppRegistry.runApplication('artboard',{rootTag:document.getElementById('root')});
