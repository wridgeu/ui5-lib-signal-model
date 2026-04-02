import Lib from "sap/ui/core/Lib";
import "sap/ui/core/library";

const library = Lib.init({
  apiVersion: 2,
  name: "ui5.model.signal",
  version: "${version}",
  dependencies: ["sap.ui.core"],
  types: [],
  interfaces: [],
  controls: [],
  elements: [],
  noLibraryCSS: true,
});

export default library;
