package app.growthalbum;

import android.app.DownloadManager;
import android.content.Context;
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
  @Override
  public void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    // 返回键：交给网页自己处理（先关大图、再回上一页并保留位置）；网页说“没有可返回的”才退出 App
    getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
      @Override
      public void handleOnBackPressed() {
        final WebView wv = getBridge().getWebView();
        wv.evaluateJavascript("(function(){try{return window.__appBack?window.__appBack():false}catch(e){return false}})()", v -> {
          if ("true".equals(v)) return;
          setEnabled(false);
          getOnBackPressedDispatcher().onBackPressed();
        });
      }
    });
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
