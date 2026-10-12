package uk.adi.macros;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * The whole app is the website; this activity is a full-screen WebView around it.
 * It fills in what a browser would normally provide: camera permission for the
 * live scanner, the file/camera pickers, the back button, and saving backups.
 */
public class MainActivity extends Activity {

    static final String HOST = "mailadisin-hub.github.io";
    static final String START_URL = "https://" + HOST + "/macros/";

    private static final int REQ_CAMERA_FOR_WEB = 1;
    private static final int REQ_CAMERA_FOR_CAPTURE = 2;
    private static final int REQ_PICK = 10;
    private static final int REQ_CAPTURE = 11;

    WebView web;
    private PermissionRequest pendingWebPermission;
    private ValueCallback<Uri[]> fileCallback;
    private Uri captureUri;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0F100D"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0F100D"));
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        // Edge-to-edge is forced on Android 15+: pad the content clear of the bars and the keyboard.
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int left, top, right, bottom;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.ime());
                left = i.left; top = i.top; right = i.right; bottom = i.bottom;
            } else {
                left = insets.getSystemWindowInsetLeft(); top = insets.getSystemWindowInsetTop();
                right = insets.getSystemWindowInsetRight(); bottom = insets.getSystemWindowInsetBottom();
            }
            v.setPadding(left, top, right, bottom);
            return insets;
        });
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) c.setSystemBarsAppearance(0,
                    WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage holds the food log and API key
        s.setMediaPlaybackRequiresUserGesture(false); // camera preview autoplays
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setUserAgentString(s.getUserAgentString() + " MacrosApp/2");

        web.addJavascriptInterface(new Bridge(), "MacrosAndroid");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }

        if (state != null) web.restoreState(state);
        else web.loadUrl(START_URL);
    }

    /** The web app opens its bottom sheets with history.pushState, so "back" closes a sheet first. */
    void goBack() {
        if (web.canGoBack()) web.goBack();
        else finish();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() { goBack(); } // Android 10-12

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    /** Camera requests carry only the origin (https://host/), never the path. */
    static boolean isOurOrigin(Uri u) {
        return u != null && "https".equals(u.getScheme()) && HOST.equals(u.getHost());
    }

    static boolean isOurs(Uri u) {
        return u != null && "https".equals(u.getScheme()) && HOST.equals(u.getHost())
                && u.getPath() != null && u.getPath().startsWith("/macros");
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
            Uri u = req.getUrl();
            if (isOurs(u)) return false;
            try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (ActivityNotFoundException ignored) { }
            return true; // links elsewhere open outside the app
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
            if (!req.isForMainFrame()) return;
            // Only reached when there is no network AND nothing cached yet (first launch offline).
            view.loadDataWithBaseURL(null,
                    "<html><body style='background:#0F100D;color:#f2f4ee;font:16px sans-serif;"
                            + "display:flex;flex-direction:column;align-items:center;justify-content:center;height:90vh;text-align:center'>"
                            + "<p>Macros needs the internet the first time it opens.</p>"
                            + "<button style='margin-top:16px;padding:12px 22px;border:0;border-radius:12px;background:#c4f16a;font:600 16px sans-serif'"
                            + " onclick=\"location.href='" + START_URL + "'\">Try again</button></body></html>",
                    "text/html", "utf-8", null);
        }
    }

    private class Chrome extends WebChromeClient {
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            boolean wantsCamera = false;
            for (String r : request.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsCamera = true;
            if (!wantsCamera || !isOurOrigin(request.getOrigin())) { request.deny(); return; }
            if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            } else {
                pendingWebPermission = request;
                requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA_FOR_WEB);
            }
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            if (params.isCaptureEnabled()) {
                if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) launchCapture();
                else requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA_FOR_CAPTURE);
            } else {
                try {
                    startActivityForResult(params.createIntent(), REQ_PICK);
                } catch (ActivityNotFoundException e) {
                    finishFileChooser(null);
                    toast("No app found to pick a file");
                }
            }
            return true;
        }
    }

    void launchCapture() {
        try {
            File dir = new File(getCacheDir(), "photos");
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
            File f = new File(dir, "photo-" + System.currentTimeMillis() + ".jpg");
            captureUri = FileProvider.getUriForFile(this, "uk.adi.macros.files", f);
            Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE)
                    .putExtra(MediaStore.EXTRA_OUTPUT, captureUri)
                    .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivityForResult(i, REQ_CAPTURE);
        } catch (Exception e) {
            android.util.Log.e("Macros", "camera capture failed", e);
            finishFileChooser(null);
            toast("Couldn't open the camera app");
        }
    }

    void finishFileChooser(Uri[] result) {
        if (fileCallback != null) fileCallback.onReceiveValue(result);
        fileCallback = null; // the page's file input stays usable only if we always answer
    }

    @Override
    protected void onActivityResult(int req, int result, Intent data) {
        super.onActivityResult(req, result, data);
        if (req == REQ_PICK) {
            finishFileChooser(pickedUris(result, data));
        } else if (req == REQ_CAPTURE) {
            finishFileChooser(result == RESULT_OK && captureUri != null ? new Uri[]{captureUri} : null);
        }
    }

    static Uri[] pickedUris(int result, Intent data) {
        if (result != RESULT_OK || data == null) return null;
        if (data.getClipData() != null) {
            Uri[] out = new Uri[data.getClipData().getItemCount()];
            for (int i = 0; i < out.length; i++) out[i] = data.getClipData().getItemAt(i).getUri();
            return out;
        }
        return data.getData() != null ? new Uri[]{data.getData()} : null;
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
        boolean ok = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (req == REQ_CAMERA_FOR_WEB && pendingWebPermission != null) {
            if (ok) pendingWebPermission.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else pendingWebPermission.deny();
            pendingWebPermission = null;
        } else if (req == REQ_CAMERA_FOR_CAPTURE) {
            if (ok) launchCapture();
            else { finishFileChooser(null); toast("Camera permission is needed to take a photo"); }
        }
    }

    void toast(String msg) { runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show()); }

    /** window.MacrosAndroid in the page. WebView can't download blob: links, so backups come through here. */
    class Bridge {
        @JavascriptInterface
        public boolean saveFile(String name, String mime, String text) {
            try {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                v.put(MediaStore.Downloads.MIME_TYPE, mime);
                Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new IllegalStateException("no uri");
                try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                    if (out == null) throw new IllegalStateException("no stream");
                    out.write(text.getBytes(StandardCharsets.UTF_8));
                }
                toast("Saved to Downloads: " + name);
                return true;
            } catch (Exception e) {
                toast("Couldn't save the backup: " + e.getMessage());
                return false;
            }
        }
    }
}
