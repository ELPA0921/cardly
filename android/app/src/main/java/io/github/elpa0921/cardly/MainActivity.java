package io.github.elpa0921.cardly;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CardlyNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
