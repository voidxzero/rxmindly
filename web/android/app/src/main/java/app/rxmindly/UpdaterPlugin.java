package app.rxmindly;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Downloads a new version of the app from its GitHub release and hands it to
 * Android's installer. The web side (web/src/lib/updates.ts) decides whether
 * there is an update; this only fetches and installs.
 *
 * Android itself refuses the file unless it is signed with the same key as the
 * installed app, so a tampered download cannot replace the app.
 */
@CapacitorPlugin(name = "Updater")
public class UpdaterPlugin extends Plugin {
    private static final int MAX_REDIRECTS = 5;

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject result = new JSObject();
        result.put("allowed", getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(result);
    }

    /** Opens the system screen where the user allows this app to install updates. */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url", "");
        String token = call.getString("token", "");
        new Thread(() -> {
            try {
                File apk = download(url, token);
                PackageInfo info = getContext().getPackageManager().getPackageArchiveInfo(apk.getPath(), 0);
                if (info == null || !getContext().getPackageName().equals(info.packageName)) {
                    apk.delete();
                    call.reject("The downloaded file is not a Rxmindly update.");
                    return;
                }
                Context context = getContext();
                Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
                call.resolve();
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? "The update could not be downloaded." : e.getMessage());
            }
        }).start();
    }

    private File download(String firstUrl, String token) throws Exception {
        File dir = new File(getContext().getCacheDir(), "updates");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("No room to save the update.");
        File target = new File(dir, "rxmindly-update.apk");

        String url = firstUrl;
        for (int hop = 0; hop <= MAX_REDIRECTS; hop++) {
            URL parsed = new URL(url);
            boolean github = "https".equals(parsed.getProtocol()) && ("api.github.com".equals(parsed.getHost()) || "github.com".equals(parsed.getHost()));
            if (hop == 0 && !github) throw new Exception("Updates only come from GitHub.");
            if (!"https".equals(parsed.getProtocol())) throw new Exception("The update link is not secure.");

            HttpURLConnection connection = (HttpURLConnection) parsed.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(30000);
            connection.setRequestProperty("Accept", "application/octet-stream");
            connection.setRequestProperty("User-Agent", "Rxmindly");
            // The access token goes to GitHub only, never to wherever GitHub redirects the download.
            if (github && token != null && !token.isEmpty()) connection.setRequestProperty("Authorization", "Bearer " + token);

            int status = connection.getResponseCode();
            if (status >= 300 && status < 400) {
                String next = connection.getHeaderField("Location");
                connection.disconnect();
                if (next == null) throw new Exception("The update link went nowhere.");
                url = new URL(parsed, next).toString();
                continue;
            }
            if (status != 200) {
                connection.disconnect();
                throw new Exception(status == 401 || status == 403 || status == 404 ? "GitHub refused the download. Check the access token." : "GitHub answered with an error (" + status + ").");
            }

            long total = connection.getContentLengthLong();
            long received = 0;
            long lastReport = 0;
            byte[] buffer = new byte[64 * 1024];
            try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(target)) {
                int n;
                while ((n = in.read(buffer)) > 0) {
                    out.write(buffer, 0, n);
                    received += n;
                    if (received - lastReport > 200 * 1024) {
                        lastReport = received;
                        JSObject progress = new JSObject();
                        progress.put("received", received);
                        progress.put("total", total);
                        notifyListeners("progress", progress);
                    }
                }
            } finally {
                connection.disconnect();
            }
            return target;
        }
        throw new Exception("The update link redirected too many times.");
    }
}
