package it.attapardi.medtracker;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-local plugins are not discovered by cap sync (it only scans
        // node_modules), so they must be registered by hand or every call
        // rejects as not-implemented.
        registerPlugin(BatterySettingsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
