package app.sakina.duas;

import android.content.Context;
import android.hardware.GeomagneticField;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.view.Surface;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Live compass heading (degrees from TRUE north) from the phone's rotation-vector sensor,
 * for the Qibla screen. Emits "heading" events about 15 times a second while started.
 */
@CapacitorPlugin(name = "Compass")
public class CompassPlugin extends Plugin implements SensorEventListener {
    private SensorManager sm;
    private Sensor sensor;
    private boolean running = false;
    private float declination = 0f;
    private long last = 0;
    private float smooth = Float.NaN;
    private int accuracy = SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM;

    @Override
    public void load() {
        sm = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        if (sm != null) {
            sensor = sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
            if (sensor == null) sensor = sm.getDefaultSensor(Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR);
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (sensor == null) { call.reject("This phone has no compass sensor"); return; }
        Double lat = call.getDouble("lat"), lng = call.getDouble("lng");
        if (lat != null && lng != null) {
            GeomagneticField gf = new GeomagneticField(lat.floatValue(), lng.floatValue(), 1200f, System.currentTimeMillis());
            declination = gf.getDeclination();
        }
        if (!running) {
            sm.registerListener(this, sensor, SensorManager.SENSOR_DELAY_GAME);
            running = true;
        }
        JSObject r = new JSObject();
        r.put("declination", declination);
        call.resolve(r);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopSensor();
        call.resolve();
    }

    private void stopSensor() {
        if (running && sm != null) sm.unregisterListener(this);
        running = false;
        smooth = Float.NaN;
    }

    @Override
    protected void handleOnPause() { if (running && sm != null) sm.unregisterListener(this); }

    @Override
    protected void handleOnResume() { if (running && sm != null) sm.registerListener(this, sensor, SensorManager.SENSOR_DELAY_GAME); }

    @Override
    public void onSensorChanged(SensorEvent event) {
        float[] rot = new float[9];
        SensorManager.getRotationMatrixFromVector(rot, event.values);
        // account for the screen rotation so "up" on screen is the direction the phone points
        int r = Surface.ROTATION_0;
        try { r = ((WindowManager) getContext().getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getRotation(); } catch (Exception ignored) { }
        float[] out = new float[9];
        switch (r) {
            case Surface.ROTATION_90: SensorManager.remapCoordinateSystem(rot, SensorManager.AXIS_Y, SensorManager.AXIS_MINUS_X, out); break;
            case Surface.ROTATION_180: SensorManager.remapCoordinateSystem(rot, SensorManager.AXIS_MINUS_X, SensorManager.AXIS_MINUS_Y, out); break;
            case Surface.ROTATION_270: SensorManager.remapCoordinateSystem(rot, SensorManager.AXIS_MINUS_Y, SensorManager.AXIS_X, out); break;
            default: out = rot;
        }
        float[] o = new float[3];
        SensorManager.getOrientation(out, o);
        float az = (float) Math.toDegrees(o[0]) + declination;
        az = (az % 360 + 360) % 360;
        // smooth along the shortest way round the circle
        if (Float.isNaN(smooth)) smooth = az;
        else {
            float d = ((az - smooth + 540) % 360) - 180;
            smooth = (smooth + d * 0.25f + 360) % 360;
        }
        long now = System.currentTimeMillis();
        if (now - last < 66) return;
        last = now;
        JSObject data = new JSObject();
        data.put("heading", smooth);
        data.put("accuracy", accuracy);
        notifyListeners("heading", data);
    }

    @Override
    public void onAccuracyChanged(Sensor s, int acc) { accuracy = acc; }
}
