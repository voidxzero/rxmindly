package app.rxmindly;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Saves an exported file on the phone. A download link does nothing inside the
 * app's web view, so this opens Android's "save to" screen instead, where the
 * user picks Downloads, Drive or anywhere else. No storage permission needed.
 */
@CapacitorPlugin(name = "FileSaver")
public class FileSaverPlugin extends Plugin {
    private String pendingText;

    @PluginMethod
    public void save(PluginCall call) {
        pendingText = call.getString("text", "");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mime", "text/plain"));
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", "rxmindly.txt"));
        startActivityForResult(call, intent, "saved");
    }

    @ActivityCallback
    private void saved(PluginCall call, ActivityResult result) {
        if (call == null) return;
        String text = pendingText;
        pendingText = null;
        JSObject answer = new JSObject();
        Uri uri = result.getData() == null ? null : result.getData().getData();
        // Backing out of the picker isn't an error: nothing was saved, that's all.
        if (result.getResultCode() != Activity.RESULT_OK || uri == null || text == null) {
            answer.put("saved", false);
            call.resolve(answer);
            return;
        }
        try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null) throw new Exception("That place can't be written to.");
            out.write(text.getBytes(StandardCharsets.UTF_8));
            answer.put("saved", true);
            call.resolve(answer);
        } catch (Exception e) {
            call.reject(e.getMessage() == null ? "The file could not be saved." : e.getMessage());
        }
    }
}
