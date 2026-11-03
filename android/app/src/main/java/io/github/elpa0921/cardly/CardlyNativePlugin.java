package io.github.elpa0921.cardly;

import android.Manifest;
import android.app.Activity;
import android.content.ContentProviderOperation;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.provider.ContactsContract;
import android.provider.ContactsContract.CommonDataKinds;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.Scope;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanner;
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning;
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * 카들리 네이티브 기능
 *  - scanDocument: Google ML Kit 문서 스캐너 (명함 테두리 자동 인식 + 반듯하게 펴기)
 *  - recognizeText: ML Kit 한국어 글자 인식 (기기 안에서, 무료)
 *  - authorize: Google 계정으로 Drive 권한 받기 (액세스 토큰, 이미 허용했으면 화면 없이 갱신)
 *  - findContact / saveContact: 휴대폰 주소록 검색, 새로 저장 또는 덮어쓰기
 */
@CapacitorPlugin(
    name = "CardlyNative",
    permissions = {
        @Permission(alias = "contacts", strings = { Manifest.permission.READ_CONTACTS, Manifest.permission.WRITE_CONTACTS })
    }
)
public class CardlyNativePlugin extends Plugin {

    private ActivityResultLauncher<IntentSenderRequest> scanLauncher;
    private ActivityResultLauncher<IntentSenderRequest> authLauncher;
    private PluginCall pendingScan;
    private PluginCall pendingAuth;
    private TextRecognizer recognizer;

    @Override
    public void load() {
        scanLauncher = getActivity().registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(), this::onScanResult);
        authLauncher = getActivity().registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(), this::onAuthResult);
    }

    // ---------- 문서 스캐너 ----------
    @PluginMethod
    public void scanDocument(PluginCall call) {
        int pageLimit = call.getInt("pageLimit", 1);
        GmsDocumentScannerOptions options = new GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(true)
            .setPageLimit(Math.max(1, pageLimit))
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
            .build();
        GmsDocumentScanner scanner = GmsDocumentScanning.getClient(options);
        pendingScan = call;
        scanner.getStartScanIntent(getActivity())
            .addOnSuccessListener(sender -> scanLauncher.launch(new IntentSenderRequest.Builder(sender).build()))
            .addOnFailureListener(e -> {
                pendingScan = null;
                call.reject("스캐너를 열 수 없습니다: " + e.getMessage());
            });
    }

    private void onScanResult(ActivityResult result) {
        PluginCall call = pendingScan;
        pendingScan = null;
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject ret = new JSObject();
            ret.put("images", new JSArray());
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }
        GmsDocumentScanningResult scan = GmsDocumentScanningResult.fromActivityResultIntent(result.getData());
        JSArray images = new JSArray();
        try {
            if (scan != null && scan.getPages() != null) {
                for (GmsDocumentScanningResult.Page page : scan.getPages()) {
                    images.put(readBase64(page.getImageUri()));
                }
            }
        } catch (Exception e) {
            call.reject("스캔 이미지를 읽지 못했습니다: " + e.getMessage());
            return;
        }
        JSObject ret = new JSObject();
        ret.put("images", images);
        ret.put("cancelled", false);
        call.resolve(ret);
    }

    private String readBase64(Uri uri) throws Exception {
        try (InputStream in = getContext().getContentResolver().openInputStream(uri);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
        }
    }

    // ---------- 글자 인식 (한국어 + 영어) ----------
    @PluginMethod
    public void recognizeText(PluginCall call) {
        String b64 = call.getString("base64");
        if (b64 == null) {
            call.reject("이미지가 없습니다.");
            return;
        }
        byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bitmap == null) {
            call.reject("이미지를 읽을 수 없습니다.");
            return;
        }
        if (recognizer == null) recognizer = TextRecognition.getClient(new KoreanTextRecognizerOptions.Builder().build());
        recognizer.process(InputImage.fromBitmap(bitmap, 0))
            .addOnSuccessListener(text -> call.resolve(textToJs(text)))
            .addOnFailureListener(e -> call.reject("글자 인식 실패: " + e.getMessage()));
    }

    private JSObject textToJs(Text text) {
        JSArray lines = new JSArray();
        for (Text.TextBlock block : text.getTextBlocks()) {
            for (Text.Line line : block.getLines()) {
                JSObject l = new JSObject();
                l.put("text", line.getText());
                l.put("height", line.getBoundingBox() != null ? line.getBoundingBox().height() : 0);
                lines.put(l);
            }
        }
        JSObject ret = new JSObject();
        ret.put("text", text.getText());
        ret.put("lines", lines);
        return ret;
    }

    // ---------- Google Drive 권한 ----------
    @PluginMethod
    public void authorize(PluginCall call) {
        JSArray scopesJs = call.getArray("scopes", new JSArray());
        List<Scope> scopes = new ArrayList<>();
        try {
            for (int i = 0; i < scopesJs.length(); i++) scopes.add(new Scope(scopesJs.getString(i)));
        } catch (Exception e) {
            call.reject("권한 범위가 올바르지 않습니다.");
            return;
        }
        boolean interactive = call.getBoolean("interactive", true);
        AuthorizationRequest request = AuthorizationRequest.builder().setRequestedScopes(scopes).build();
        Identity.getAuthorizationClient(getActivity())
            .authorize(request)
            .addOnSuccessListener(result -> {
                if (result.hasResolution()) {
                    if (!interactive || result.getPendingIntent() == null) {
                        call.reject("NEED_INTERACTION");
                        return;
                    }
                    pendingAuth = call;
                    authLauncher.launch(new IntentSenderRequest.Builder(result.getPendingIntent().getIntentSender()).build());
                } else {
                    call.resolve(authToJs(result));
                }
            })
            .addOnFailureListener(e -> call.reject("Google 권한 요청 실패: " + e.getMessage()));
    }

    private void onAuthResult(ActivityResult result) {
        PluginCall call = pendingAuth;
        pendingAuth = null;
        if (call == null) return;
        try {
            AuthorizationResult auth = Identity.getAuthorizationClient(getActivity())
                .getAuthorizationResultFromIntent(result.getData());
            call.resolve(authToJs(auth));
        } catch (Exception e) {
            call.reject("로그인이 취소되었습니다.");
        }
    }

    private JSObject authToJs(AuthorizationResult result) {
        JSObject ret = new JSObject();
        ret.put("accessToken", result.getAccessToken());
        return ret;
    }

    // ---------- 주소록 ----------
    private boolean ensureContactsPermission(PluginCall call, String callback) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) return true;
        requestPermissionForAlias("contacts", call, callback);
        return false;
    }

    @PermissionCallback
    private void contactsPermissionForFind(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) findContact(call);
        else call.reject("주소록 권한이 필요합니다.");
    }

    @PermissionCallback
    private void contactsPermissionForSave(PluginCall call) {
        if (getPermissionState("contacts") == PermissionState.GRANTED) saveContact(call);
        else call.reject("주소록 권한이 필요합니다.");
    }

    /** 전화번호로 기존 연락처 찾기: { phones: [...] } → { matches: [{ contactId, name, phone }] } */
    @PluginMethod
    public void findContact(PluginCall call) {
        if (!ensureContactsPermission(call, "contactsPermissionForFind")) return;
        JSArray phones = call.getArray("phones", new JSArray());
        JSArray matches = new JSArray();
        List<Long> seen = new ArrayList<>();
        ContentResolver cr = getContext().getContentResolver();
        try {
            for (int i = 0; i < phones.length(); i++) {
                String number = phones.getString(i);
                if (number == null || number.replaceAll("\\D", "").length() < 7) continue;
                Uri uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number));
                try (Cursor c = cr.query(uri, new String[] { ContactsContract.PhoneLookup.CONTACT_ID, ContactsContract.PhoneLookup.DISPLAY_NAME }, null, null, null)) {
                    while (c != null && c.moveToNext()) {
                        long id = c.getLong(0);
                        if (seen.contains(id)) continue;
                        seen.add(id);
                        JSObject m = new JSObject();
                        m.put("contactId", String.valueOf(id));
                        m.put("name", c.getString(1));
                        m.put("phone", number);
                        matches.put(m);
                    }
                }
            }
        } catch (Exception e) {
            call.reject("주소록 검색 실패: " + e.getMessage());
            return;
        }
        JSObject ret = new JSObject();
        ret.put("matches", matches);
        call.resolve(ret);
    }

    /**
     * 연락처 저장. contactId가 있으면 그 연락처를 명함 내용으로 덮어씁니다.
     * (이름/회사/직책/이메일/주소/홈페이지/메모는 교체, 전화번호는 휴대폰·직장·팩스 번호만 교체하고 다른 번호는 유지)
     */
    @PluginMethod
    public void saveContact(PluginCall call) {
        if (!ensureContactsPermission(call, "contactsPermissionForSave")) return;
        String contactId = call.getString("contactId");
        ContentResolver cr = getContext().getContentResolver();
        ArrayList<ContentProviderOperation> ops = new ArrayList<>();
        try {
            long rawId = -1;
            if (contactId != null && !contactId.isEmpty()) {
                try (Cursor c = cr.query(ContactsContract.RawContacts.CONTENT_URI, new String[] { ContactsContract.RawContacts._ID },
                        ContactsContract.RawContacts.CONTACT_ID + "=? AND " + ContactsContract.RawContacts.DELETED + "=0",
                        new String[] { contactId }, null)) {
                    if (c != null && c.moveToFirst()) rawId = c.getLong(0);
                }
                if (rawId < 0) {
                    call.reject("기존 연락처를 찾을 수 없습니다.");
                    return;
                }
                String raw = String.valueOf(rawId);
                String[] replaced = {
                    CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE, CommonDataKinds.Organization.CONTENT_ITEM_TYPE,
                    CommonDataKinds.Email.CONTENT_ITEM_TYPE, CommonDataKinds.StructuredPostal.CONTENT_ITEM_TYPE,
                    CommonDataKinds.Website.CONTENT_ITEM_TYPE, CommonDataKinds.Note.CONTENT_ITEM_TYPE,
                };
                for (String mime : replaced) {
                    ops.add(ContentProviderOperation.newDelete(ContactsContract.Data.CONTENT_URI)
                        .withSelection(ContactsContract.Data.RAW_CONTACT_ID + "=? AND " + ContactsContract.Data.MIMETYPE + "=?", new String[] { raw, mime })
                        .build());
                }
                ops.add(ContentProviderOperation.newDelete(ContactsContract.Data.CONTENT_URI)
                    .withSelection(ContactsContract.Data.RAW_CONTACT_ID + "=? AND " + ContactsContract.Data.MIMETYPE + "=? AND "
                            + CommonDataKinds.Phone.TYPE + " IN (?,?,?)",
                        new String[] { raw, CommonDataKinds.Phone.CONTENT_ITEM_TYPE,
                            String.valueOf(CommonDataKinds.Phone.TYPE_MOBILE), String.valueOf(CommonDataKinds.Phone.TYPE_WORK),
                            String.valueOf(CommonDataKinds.Phone.TYPE_FAX_WORK) })
                    .build());
                addRows(ops, call, rawId, -1);
            } else {
                ops.add(ContentProviderOperation.newInsert(ContactsContract.RawContacts.CONTENT_URI)
                    .withValue(ContactsContract.RawContacts.ACCOUNT_TYPE, null)
                    .withValue(ContactsContract.RawContacts.ACCOUNT_NAME, null)
                    .build());
                addRows(ops, call, -1, 0);
            }
            android.content.ContentProviderResult[] results = cr.applyBatch(ContactsContract.AUTHORITY, ops);
            String savedId = contactId;
            if (savedId == null || savedId.isEmpty()) {
                long newRaw = ContentUris.parseId(results[0].uri);
                try (Cursor c = cr.query(ContactsContract.RawContacts.CONTENT_URI, new String[] { ContactsContract.RawContacts.CONTACT_ID },
                        ContactsContract.RawContacts._ID + "=?", new String[] { String.valueOf(newRaw) }, null)) {
                    if (c != null && c.moveToFirst()) savedId = String.valueOf(c.getLong(0));
                }
            }
            JSObject ret = new JSObject();
            ret.put("contactId", savedId);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("연락처 저장 실패: " + e.getMessage());
        }
    }

    // rawId >= 0 이면 기존 원본 연락처에, 아니면 ops[backRef]로 새로 만든 원본 연락처에 행을 추가
    private void addRows(ArrayList<ContentProviderOperation> ops, PluginCall call, long rawId, int backRef) {
        String name = call.getString("name", "");
        String company = call.getString("company", "");
        String department = call.getString("department", "");
        String title = call.getString("title", "");

        if (!name.isEmpty() || !company.isEmpty()) {
            ops.add(row(rawId, backRef, CommonDataKinds.StructuredName.CONTENT_ITEM_TYPE)
                .withValue(CommonDataKinds.StructuredName.DISPLAY_NAME, name.isEmpty() ? company : name).build());
        }
        if (!company.isEmpty() || !department.isEmpty() || !title.isEmpty()) {
            ops.add(row(rawId, backRef, CommonDataKinds.Organization.CONTENT_ITEM_TYPE)
                .withValue(CommonDataKinds.Organization.COMPANY, company)
                .withValue(CommonDataKinds.Organization.DEPARTMENT, department)
                .withValue(CommonDataKinds.Organization.TITLE, title)
                .withValue(CommonDataKinds.Organization.TYPE, CommonDataKinds.Organization.TYPE_WORK).build());
        }
        addPhone(ops, rawId, backRef, call.getString("mobile", ""), CommonDataKinds.Phone.TYPE_MOBILE);
        addPhone(ops, rawId, backRef, call.getString("phone", ""), CommonDataKinds.Phone.TYPE_WORK);
        addPhone(ops, rawId, backRef, call.getString("fax", ""), CommonDataKinds.Phone.TYPE_FAX_WORK);
        String email = call.getString("email", "");
        if (!email.isEmpty()) {
            ops.add(row(rawId, backRef, CommonDataKinds.Email.CONTENT_ITEM_TYPE)
                .withValue(CommonDataKinds.Email.ADDRESS, email)
                .withValue(CommonDataKinds.Email.TYPE, CommonDataKinds.Email.TYPE_WORK).build());
        }
        String address = call.getString("address", "");
        if (!address.isEmpty()) {
            ops.add(row(rawId, backRef, CommonDataKinds.StructuredPostal.CONTENT_ITEM_TYPE)
                .withValue(CommonDataKinds.StructuredPostal.FORMATTED_ADDRESS, address)
                .withValue(CommonDataKinds.StructuredPostal.TYPE, CommonDataKinds.StructuredPostal.TYPE_WORK).build());
        }
        String website = call.getString("website", "");
        if (!website.isEmpty()) {
            ops.add(row(rawId, backRef, CommonDataKinds.Website.CONTENT_ITEM_TYPE)
                .withValue(CommonDataKinds.Website.URL, website)
                .withValue(CommonDataKinds.Website.TYPE, CommonDataKinds.Website.TYPE_WORK).build());
        }
        String memo = call.getString("memo", "");
        if (!memo.isEmpty()) {
            ops.add(row(rawId, backRef, CommonDataKinds.Note.CONTENT_ITEM_TYPE)
                .withValue(CommonDataKinds.Note.NOTE, memo).build());
        }
    }

    private void addPhone(ArrayList<ContentProviderOperation> ops, long rawId, int backRef, String number, int type) {
        if (number == null || number.isEmpty()) return;
        ops.add(row(rawId, backRef, CommonDataKinds.Phone.CONTENT_ITEM_TYPE)
            .withValue(CommonDataKinds.Phone.NUMBER, number)
            .withValue(CommonDataKinds.Phone.TYPE, type).build());
    }

    private ContentProviderOperation.Builder row(long rawId, int backRef, String mime) {
        ContentProviderOperation.Builder b = ContentProviderOperation.newInsert(ContactsContract.Data.CONTENT_URI)
            .withValue(ContactsContract.Data.MIMETYPE, mime);
        if (rawId >= 0) b.withValue(ContactsContract.Data.RAW_CONTACT_ID, rawId);
        else b.withValueBackReference(ContactsContract.Data.RAW_CONTACT_ID, backRef);
        return b;
    }
}
