import {AppRegistry} from 'react-native';
import {PhotoCatalogDemo} from '../../../examples/native-instruments/PhotoCatalogDemo.tsx';
AppRegistry.registerComponent('PhotoCatalogDemo',()=>PhotoCatalogDemo);
AppRegistry.runApplication('PhotoCatalogDemo',{rootTag:document.getElementById('root')});
