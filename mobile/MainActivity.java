package app.growthalbum;

import android.app.DownloadManager;
import android.content.Context;
import android.content.res.Configuration;
import android.util.DisplayMetrics;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import android.webkit.URLUtil;
import android.widget.Toast;

import com.getcapacitor.BridgeActivity;

// Capacitor 的 WebView 默认不处理“下载”，网页里的下载链接（导出 zip、回顾视频 MP4、原图）点了没反应。
// 这里接管下载：带上登录 cookie，交给系统下载管理器，文件存到手机“下载”文件夹，完成后通知栏提示。
public class MainActivity extends BridgeActivity {
  // 不跟随系统的「显示大小」和「字体大小」：界面密度固定为手机出厂默认，字体缩放固定为 1。
  // （vivo 等手机调大“显示大小”后，网页布局会被整体放大而走形；这样 App 里就不受影响。）
  @Override
  protected void attachBaseContext(Context base) {
    Configuration c = new Configuration(base.getResources().getConfiguration());
    c.fontScale = 1.0f;
    c.densityDpi = DisplayMetrics.DENSITY_DEVICE_STABLE;
    super.attachBaseContext(base.createConfigurationContext(c));
  }

  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // 返回键：交给网页自己处理（先关大图、再回上一页并保留位置）；网页说“没有可返回的”才退到桌面。
    // 注意：这个回调必须始终保持启用。以前在首页返回时调用 setEnabled(false) 再走系统默认返回，
    // 回调从此被永久关掉；App 没被杀掉、再次打开时，所有页面按返回都会被系统直接送回桌面。
    // 现在改为 moveTaskToBack(true)（效果和按 Home 一样，App 留在后台），回调不再被关闭。
    getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
      @Override
      public void handleOnBackPressed() {
        final WebView wv = getBridge() == null ? null : getBridge().getWebView();
        if (wv == null) { moveTaskToBack(true); return; }
        wv.evaluateJavascript("(function(){try{return window.__appBack?window.__appBack():false}catch(e){return false}})()", v -> {
          if ("true".equals(v)) return;
          moveTaskToBack(true);
        });
      }
    });
    // 隐藏 WebView 自带的长滚动条（右边那条灰色长条）；页面照常可以滑动，网页里选日期的小滑条不受影响
    getBridge().getWebView().getSettings().setTextZoom(100);   // 网页文字不随系统字体大小缩放
    getBridge().getWebView().setVerticalScrollBarEnabled(false);
    getBridge().getWebView().setHorizontalScrollBarEnabled(false);
    getBridge().getWebView().setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
      try {
        String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
        DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
        String cookie = CookieManager.getInstance().getCookie(url);
        if (cookie != null) r.addRequestHeader("Cookie", cookie);
        if (userAgent != null) r.addRequestHeader("User-Agent", userAgent);
        if (mimeType != null) r.setMimeType(mimeType);
        r.setTitle(name);
        r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
        ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(r);
        Toast.makeText(this, "开始下载：" + name + "（完成后在通知栏和“下载”文件夹里）", Toast.LENGTH_LONG).show();
      } catch (Exception e) {
        Toast.makeText(this, "下载失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
      }
    });
  }
}
