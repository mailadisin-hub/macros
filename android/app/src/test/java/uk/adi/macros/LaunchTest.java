package uk.adi.macros;

import static org.junit.Assert.*;

import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import com.google.androidbrowserhelper.trusted.LauncherActivity;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.android.controller.ActivityController;
import org.robolectric.shadows.ShadowPackageManager;
import androidx.test.core.app.ApplicationProvider;

/** Launches the real LauncherActivity with the real manifest meta-data: it must not crash, with or without a browser.
 *  (Robolectric can't run Chrome, so where it hands off to is checked on the phone, not here.) */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class LaunchTest {

    /** What the home screen sends: MAIN/LAUNCHER in a new task. */
    private static Intent launcherIntent() {
        Intent i = new Intent(Intent.ACTION_MAIN);
        i.addCategory(Intent.CATEGORY_LAUNCHER);
        i.setClassName("uk.adi.macros", LauncherActivity.class.getName());
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        return i;
    }

    @Test
    public void launchesWithoutCrashing_noBrowser() {
        ActivityController<LauncherActivity> c = Robolectric.buildActivity(LauncherActivity.class, launcherIntent()).setup();
        Intent next = Shadows.shadowOf(c.get()).getNextStartedActivity();
        System.out.println("no browser -> next activity: " + next);
    }

    @Test
    public void launchesWithoutCrashing_withPlainBrowser() {
        android.app.Application app = ApplicationProvider.getApplicationContext();
        ShadowPackageManager pm = Shadows.shadowOf(app.getPackageManager());
        Intent view = new Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com"));
        ResolveInfo ri = new ResolveInfo();
        ri.activityInfo = new ActivityInfo();
        ri.activityInfo.packageName = "com.example.browser";
        ri.activityInfo.name = "Main";
        pm.addResolveInfoForIntent(view, ri);
        ActivityController<LauncherActivity> c = Robolectric.buildActivity(LauncherActivity.class, launcherIntent()).setup();
        Intent next = Shadows.shadowOf(c.get()).getNextStartedActivity();
        System.out.println("plain browser -> next activity: " + next + " data=" + (next == null ? null : next.getData()));
    }
}
