package com.flyp.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;

/**
 * Saving a chat photo or video to the phone's gallery.
 *
 * The web layer cannot do this at all. An <a download> is inert inside an
 * Android WebView, and the system share sheet - which is what the app fell
 * back to - offers "send to another app", not "save to Photos". Testers
 * reported exactly that: the Save button appeared to work and nothing ever
 * turned up in the gallery.
 *
 * Deliberately Android 10 (API 29) and up only. From 29 scoped storage lets an
 * app insert into MediaStore with NO permission of any kind, which is why this
 * plugin needs no runtime permission request and no manifest change. Below 29
 * the same operation needs WRITE_EXTERNAL_STORAGE plus a runtime prompt, so
 * this rejects with UNSUPPORTED instead and the JS falls back to the share
 * sheet, which on those versions is the honest option.
 */
@CapacitorPlugin(name = "MediaSave")
public class MediaSavePlugin extends Plugin {

    @PluginMethod
    public void saveToGallery(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("UNSUPPORTED");
            return;
        }

        String data = call.getString("data");
        String name = call.getString("name", "flyp");
        String mime = call.getString("mime", "image/jpeg");

        if (data == null || data.isEmpty()) {
            call.reject("no data");
            return;
        }

        Uri item = null;
        ContentResolver cr = getContext().getContentResolver();
        try {
            // The JS side sends a data: URL from FileReader, so strip the
            // "data:image/jpeg;base64," prefix if it is still attached.
            int comma = data.indexOf(',');
            if (data.startsWith("data:") && comma > -1) {
                data = data.substring(comma + 1);
            }
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);

            boolean isVideo = mime.startsWith("video");
            Uri collection = isVideo
                ? MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                : MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);

            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            // Its own album, so saved media is not scattered through Camera.
            v.put(MediaStore.MediaColumns.RELATIVE_PATH,
                  (isVideo ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_PICTURES) + "/FLYP");
            // Hidden from the gallery until the bytes are actually written, so
            // a failure halfway through cannot leave a broken thumbnail behind.
            v.put(MediaStore.MediaColumns.IS_PENDING, 1);

            item = cr.insert(collection, v);
            if (item == null) {
                call.reject("could not create gallery entry");
                return;
            }

            OutputStream os = cr.openOutputStream(item);
            if (os == null) {
                cr.delete(item, null, null);
                call.reject("could not open gallery entry for writing");
                return;
            }
            try {
                os.write(bytes);
                os.flush();
            } finally {
                os.close();
            }

            ContentValues done = new ContentValues();
            done.put(MediaStore.MediaColumns.IS_PENDING, 0);
            cr.update(item, done, null, null);

            JSObject r = new JSObject();
            r.put("uri", item.toString());
            call.resolve(r);
        } catch (Exception e) {
            // Remove the placeholder row, or the gallery keeps a zero-byte
            // entry that renders as a grey box for ever.
            if (item != null) {
                try { cr.delete(item, null, null); } catch (Exception ignored) {}
            }
            call.reject(e.getMessage() == null ? "save failed" : e.getMessage());
        }
    }
}
