function comfytvJsonString(value) {
    return '"' + String(value)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n")
        .replace(/\t/g, "\\t") + '"';
}

function comfytvError(message) {
    return '{"ok":false,"error":' + comfytvJsonString(message) + '}';
}

function comfytvBounds(bounds) {
    return {
        left: Math.floor(bounds[0].as("px")),
        top: Math.floor(bounds[1].as("px")),
        right: Math.ceil(bounds[2].as("px")),
        bottom: Math.ceil(bounds[3].as("px"))
    };
}

function comfytvActiveSelectionBounds(document) {
    try {
        return comfytvBounds(document.selection.bounds);
    } catch (error) {
        return null;
    }
}

function comfytvBoundsJson(bounds) {
    if (bounds === null) {
        return "null";
    }
    return '{"left":' + bounds.left + ',"top":' + bounds.top +
        ',"right":' + bounds.right + ',"bottom":' + bounds.bottom + '}';
}

function comfytvSelectLayer(layerID) {
    var reference = new ActionReference();
    reference.putIdentifier(charIDToTypeID("Lyr "), layerID);
    var descriptor = new ActionDescriptor();
    descriptor.putReference(charIDToTypeID("null"), reference);
    descriptor.putBoolean(charIDToTypeID("MkVs"), false);
    executeAction(charIDToTypeID("slct"), descriptor, DialogModes.NO);
}

function comfytvQuickExportPng(folderPath) {
    var descriptor = new ActionDescriptor();
    var reference = new ActionReference();
    reference.putEnumerated(
        stringIDToTypeID("layer"),
        stringIDToTypeID("ordinal"),
        stringIDToTypeID("targetEnum")
    );
    descriptor.putReference(stringIDToTypeID("null"), reference);
    descriptor.putString(stringIDToTypeID("fileType"), "png");
    descriptor.putInteger(stringIDToTypeID("quality"), 32);
    descriptor.putInteger(stringIDToTypeID("metadata"), 0);
    descriptor.putString(stringIDToTypeID("destFolder"), folderPath);
    descriptor.putBoolean(stringIDToTypeID("sRGB"), true);
    descriptor.putBoolean(stringIDToTypeID("openWindow"), false);
    executeAction(stringIDToTypeID("exportSelectionAsFileTypePressed"), descriptor, DialogModes.NO);
}

function comfytvExportActiveLayer() {
    try {
        if (app.documents.length === 0) {
            return comfytvError("No Photoshop document is open");
        }

        var document = app.activeDocument;
        var layer = document.activeLayer;
        var layerBounds = comfytvBounds(layer.bounds);
        var selectionBounds = comfytvActiveSelectionBounds(document);
        var outputBounds = selectionBounds || layerBounds;
        if (outputBounds.right <= outputBounds.left || outputBounds.bottom <= outputBounds.top) {
            return comfytvError("The selected layer has no visible pixels");
        }

        var outputFolder = new Folder(
            Folder.temp.fsName + "/comfytv-layer-" + new Date().getTime() + "-" +
            Math.floor(Math.random() * 1000000)
        );
        if (!outputFolder.create()) {
            return comfytvError("Could not create the export folder");
        }

        comfytvSelectLayer(layer.id);
        comfytvQuickExportPng(outputFolder.fsName);

        return '{"ok":true,"export_dir":' + comfytvJsonString(outputFolder.fsName) +
            ',"document":' + comfytvJsonString(document.name) +
            ',"layer":' + comfytvJsonString(layer.name) +
            ',"bounds":' + comfytvBoundsJson(outputBounds) +
            ',"layer_bounds":' + comfytvBoundsJson(layerBounds) +
            ',"selection_bounds":' + comfytvBoundsJson(selectionBounds) + '}';
    } catch (error) {
        return comfytvError(error.message || error);
    }
}
