package uk.adi.macros;

import static org.junit.Assert.*;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowActivity;
import org.robolectric.shadows.ShadowWebView;

/** Runs the real MainActivity on a simulated Android 14 (Robolectric). WebView JS itself can't run here. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class LaunchTest {

    private MainActivity launch() {
        return Robolectric.buildActivity(MainActivity.class).setup().get();
    }

    @Test
    public void launchesAndLoadsTheSiteWithStorageAndJs() {
        MainActivity a = launch();
        ShadowWebView sw = Shadows.shadowOf(a.web);
        assertEquals("https://mailadisin-hub.github.io/macros/", sw.getLastLoadedUrl());
        assertTrue("JS on", a.web.getSettings().getJavaScriptEnabled());
        assertTrue("localStorage on (holds log + key)", a.web.getSettings().getDomStorageEnabled());
        assertFalse(a.web.getSettings().getMediaPlaybackRequiresUserGesture());
        assertTrue(a.web.getSettings().getUserAgentString().endsWith("MacrosApp/2"));
        assertNotNull("backup bridge exposed", sw.getJavascriptInterface("MacrosAndroid"));
    }

    @Test
    public void onlyOurPagesStayInTheApp() {
        assertTrue(MainActivity.isOurs(Uri.parse("https://mailadisin-hub.github.io/macros/")));
        assertTrue(MainActivity.isOurs(Uri.parse("https://mailadisin-hub.github.io/macros/index.html")));
        assertFalse(MainActivity.isOurs(Uri.parse("https://mailadisin-hub.github.io/notes/")));
        assertFalse(MainActivity.isOurs(Uri.parse("http://mailadisin-hub.github.io/macros/")));
        assertFalse(MainActivity.isOurs(Uri.parse("https://openrouter.ai/keys")));
        // what WebView really passes for a camera request: origin only
        assertTrue(MainActivity.isOurOrigin(Uri.parse("https://mailadisin-hub.github.io/")));
        assertFalse(MainActivity.isOurOrigin(Uri.parse("https://example.com/")));

        MainActivity a = launch();
        WebViewClient c = Shadows.shadowOf(a.web).getWebViewClient();
        assertTrue("external link handed to another app",
                c.shouldOverrideUrlLoading(a.web, req("https://openrouter.ai/keys")));
        Intent next = Shadows.shadowOf(a).getNextStartedActivity();
        assertEquals(Intent.ACTION_VIEW, next.getAction());
        assertFalse(c.shouldOverrideUrlLoading(a.web, req("https://mailadisin-hub.github.io/macros/")));
    }

    @Test
    public void cameraForLiveScannerAsksAndroidThenGrantsThePage() {
        MainActivity a = launch();
        ShadowActivity sa = Shadows.shadowOf(a);
        sa.denyPermissions(Manifest.permission.CAMERA);
        WebChromeClient chrome = Shadows.shadowOf(a.web).getWebChromeClient();

        FakePermission p = new FakePermission("https://mailadisin-hub.github.io/");
        chrome.onPermissionRequest(p);
        ShadowActivity.PermissionsRequest asked = sa.getLastRequestedPermission();
        assertNotNull("asked Android for the camera", asked);
        assertEquals(Manifest.permission.CAMERA, asked.requestedPermissions[0]);
        assertNull("page waits for the answer", p.result);

        sa.grantPermissions(Manifest.permission.CAMERA);
        a.onRequestPermissionsResult(asked.requestCode, asked.requestedPermissions, new int[]{0});
        assertEquals("granted", p.result);

        // already granted: straight through
        FakePermission p2 = new FakePermission("https://mailadisin-hub.github.io/");
        chrome.onPermissionRequest(p2);
        assertEquals("granted", p2.result);

        // another site never gets the camera
        FakePermission evil = new FakePermission("https://example.com/");
        chrome.onPermissionRequest(evil);
        assertEquals("denied", evil.result);
    }

    @Test
    public void galleryPickerAlwaysAnswersThePage() {
        MainActivity a = launch();
        WebChromeClient chrome = Shadows.shadowOf(a.web).getWebChromeClient();
        List<Uri[]> got = new ArrayList<>();
        boolean handled = chrome.onShowFileChooser(a.web, got::add, new Params(false));
        assertTrue(handled);
        Intent pick = Shadows.shadowOf(a).getNextStartedActivity();
        assertEquals(Intent.ACTION_GET_CONTENT, pick.getAction());

        // user backs out of the picker: page must still get an answer or the input breaks
        Shadows.shadowOf(a).receiveResult(pick, Activity.RESULT_CANCELED, null);
        assertEquals(1, got.size());
        assertNull(got.get(0));
    }

    @Test
    public void phoneCameraButtonOpensTheCameraApp() throws Exception {
        // FileProvider caches each authority's folders in a static map; Robolectric gives every
        // test a fresh data dir, so drop the previous test's entry (a phone only ever has one).
        java.lang.reflect.Field cache = androidx.core.content.FileProvider.class.getDeclaredField("sCache");
        cache.setAccessible(true);
        ((java.util.Map<?, ?>) cache.get(null)).clear();
        // FileProvider.belongsToRoot() checks paths with a hard-coded '/', so on a Windows host every
        // Robolectric path ('\') is rejected. Android always uses '/', so this only runs off Windows.
        org.junit.Assume.assumeFalse(java.io.File.separatorChar == '\\');
        MainActivity a = launch();
        Shadows.shadowOf(a).grantPermissions(Manifest.permission.CAMERA);
        WebChromeClient chrome = Shadows.shadowOf(a.web).getWebChromeClient();
        List<Uri[]> got = new ArrayList<>();
        chrome.onShowFileChooser(a.web, got::add, new Params(true));
        Intent cap = Shadows.shadowOf(a).getNextStartedActivity();
        assertNotNull("camera app launched: " + org.robolectric.shadows.ShadowLog.getLogsForTag("Macros").stream().map(l -> String.valueOf(l.throwable)).reduce("", String::concat), cap);
        assertEquals(android.provider.MediaStore.ACTION_IMAGE_CAPTURE, cap.getAction());
        Uri out = cap.getParcelableExtra(android.provider.MediaStore.EXTRA_OUTPUT);
        assertNotNull(out);
        Shadows.shadowOf(a).receiveResult(cap, Activity.RESULT_OK, null);
        assertEquals(out, got.get(0)[0]);
    }

    @Test
    public void phoneCameraWithoutPermissionAsksFirstAndAnswersPageIfRefused() {
        MainActivity a = launch();
        ShadowActivity sa = Shadows.shadowOf(a);
        sa.denyPermissions(Manifest.permission.CAMERA);
        WebChromeClient chrome = Shadows.shadowOf(a.web).getWebChromeClient();
        List<Uri[]> got = new ArrayList<>();
        chrome.onShowFileChooser(a.web, got::add, new Params(true));
        ShadowActivity.PermissionsRequest asked = sa.getLastRequestedPermission();
        assertEquals(Manifest.permission.CAMERA, asked.requestedPermissions[0]);
        a.onRequestPermissionsResult(asked.requestCode, asked.requestedPermissions, new int[]{-1});
        assertEquals("page told 'no photo' so its button keeps working", 1, got.size());
        assertNull(got.get(0));
    }

    @Test
    public void photoPathIsInsideTheSharedFolderConfig() throws Exception {
        // The real check FileProvider does on a phone: cache/photos/ is declared in res/xml/file_paths.xml.
        String xml = new String(java.nio.file.Files.readAllBytes(java.nio.file.Paths.get("src/main/res/xml/file_paths.xml")));
        assertTrue(xml.contains("<cache-path name=\"photos\" path=\"photos/\""));
    }

    @Test
    public void backClosesTheAppWhenNothingToGoBackTo() {
        MainActivity a = launch();
        a.goBack();
        assertTrue(a.isFinishing());
    }

    // ---- helpers ----

    private static android.webkit.WebResourceRequest req(String url) {
        return new android.webkit.WebResourceRequest() {
            public Uri getUrl() { return Uri.parse(url); }
            public boolean isForMainFrame() { return true; }
            public boolean isRedirect() { return false; }
            public boolean hasGesture() { return true; }
            public String getMethod() { return "GET"; }
            public java.util.Map<String, String> getRequestHeaders() { return new java.util.HashMap<>(); }
        };
    }

    static class FakePermission extends PermissionRequest {
        final Uri origin; String result;
        FakePermission(String origin) { this.origin = Uri.parse(origin); }
        public Uri getOrigin() { return origin; }
        public String[] getResources() { return new String[]{RESOURCE_VIDEO_CAPTURE}; }
        public void grant(String[] r) { result = "granted"; }
        public void deny() { result = "denied"; }
    }

    static class Params extends WebChromeClient.FileChooserParams {
        final boolean capture;
        Params(boolean capture) { this.capture = capture; }
        public int getMode() { return MODE_OPEN; }
        public String[] getAcceptTypes() { return new String[]{"image/*"}; }
        public boolean isCaptureEnabled() { return capture; }
        public CharSequence getTitle() { return null; }
        public String getFilenameHint() { return null; }
        public Intent createIntent() {
            return new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*");
        }
    }
}
