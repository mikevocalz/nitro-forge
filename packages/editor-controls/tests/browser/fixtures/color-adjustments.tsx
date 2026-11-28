import {AppRegistry} from "react-native";
import {ColorAdjustmentsDemo} from "../../../examples/native-instruments/ColorAdjustmentsDemo.tsx";
const query=new URLSearchParams(location.search);
document.documentElement.dataset.theme=query.get('theme')??'light';
document.documentElement.dir=query.get('dir')??'ltr';
AppRegistry.registerComponent('ColorAdjustmentsDemo',()=>()=> <ColorAdjustmentsDemo fail={query.has('fail')}/>);
AppRegistry.runApplication('ColorAdjustmentsDemo',{rootTag:document.getElementById('root')});
