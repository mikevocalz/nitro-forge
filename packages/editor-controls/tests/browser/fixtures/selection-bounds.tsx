import {AppRegistry} from 'react-native';
import {SelectionBoundsDemo} from '../../../examples/native-instruments/SelectionBoundsDemo.tsx';
const params=new URLSearchParams(location.search);document.documentElement.dir=params.get('dir')??'ltr';document.body.style.margin='0';
AppRegistry.registerComponent('selection-bounds',()=>()=> <SelectionBoundsDemo hinge={params.get('hinge')==='1'} withNavigation={params.get('navigation')==='1'}/>);AppRegistry.runApplication('selection-bounds',{rootTag:document.getElementById('root')});
