import {AppRegistry} from "react-native";
import {ColorManagementDemo} from "../../../examples/native-instruments/ColorManagementDemo.tsx";
const query=new URLSearchParams(location.search);
document.documentElement.dataset.theme=query.get('theme')??'light';
document.documentElement.dir=query.get('dir')??'ltr';
AppRegistry.registerComponent('ColorManagementDemo',()=>()=> <ColorManagementDemo fail={query.has('fail')}/>);
AppRegistry.runApplication('ColorManagementDemo',{rootTag:document.getElementById('root')});
