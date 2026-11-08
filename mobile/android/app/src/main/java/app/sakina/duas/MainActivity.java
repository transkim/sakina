package app.sakina.duas;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(QuranPlaybackPlugin.class);
        registerPlugin(CompassPlugin.class); registerPlugin(AdhkarPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
