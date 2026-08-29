# Supabase email templates — Tenth Tone

Paste these into **Supabase → Authentication → Email Templates**.

Both are bilingual, Arabic first with English underneath, because Supabase
templates cannot know which language the person picked in the app.

Both use `{{ .Token }}` — the six digit code. The default Supabase templates
use `{{ .ConfirmationURL }}`, a magic link, which the app's OTP screen cannot
accept. If you leave the default, signup breaks.

Styles are inline and there are no external images or fonts, because email
clients strip stylesheets and block remote assets.

---

## 1. Confirm signup

**Subject:** `رمز تفعيل حسابك في Tenth Tone / Your Tenth Tone code`

```html
<div style="margin:0;padding:24px;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Tahoma,Arial,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">

    <div style="font-size:20px;font-weight:700;color:#6c2bd9;margin-bottom:28px">Tenth Tone</div>

    <div dir="rtl" style="text-align:right">
      <div style="font-size:19px;font-weight:700;color:#16161c;margin-bottom:8px">رمز تفعيل حسابك</div>
      <div style="font-size:15px;color:#5a5a66;line-height:1.7">
        أدخل هذا الرمز في التطبيق لإكمال إنشاء حسابك.
      </div>
    </div>

    <div style="margin:26px 0;padding:20px;background:#f1ebff;border-radius:12px;text-align:center">
      <div style="font-size:34px;font-weight:700;letter-spacing:10px;color:#3d1580;font-family:monospace">{{ .Token }}</div>
    </div>

    <div dir="rtl" style="text-align:right;font-size:13.5px;color:#8a8a95;line-height:1.7">
      الرمز صالح لمدة ساعة واحدة. إذا لم تطلب هذا الرمز فتجاهل هذه الرسالة، ولن يُنشأ أي حساب.
    </div>

    <div style="height:1px;background:#e8e6ef;margin:26px 0"></div>

    <div dir="ltr" style="text-align:left">
      <div style="font-size:16px;font-weight:700;color:#16161c;margin-bottom:6px">Your verification code</div>
      <div style="font-size:14px;color:#5a5a66;line-height:1.7">
        Enter the code above in the app to finish creating your account.
        It is valid for one hour. If you did not ask for it, ignore this email
        and no account will be created.
      </div>
    </div>

    <div style="margin-top:26px;font-size:12px;color:#a5a4b0">Tenth Tone</div>
  </div>
</div>
```

---

## 2. Reset password

**Subject:** `رمز إعادة تعيين كلمة المرور / Your password reset code`

```html
<div style="margin:0;padding:24px;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Tahoma,Arial,sans-serif">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">

    <div style="font-size:20px;font-weight:700;color:#6c2bd9;margin-bottom:28px">Tenth Tone</div>

    <div dir="rtl" style="text-align:right">
      <div style="font-size:19px;font-weight:700;color:#16161c;margin-bottom:8px">إعادة تعيين كلمة المرور</div>
      <div style="font-size:15px;color:#5a5a66;line-height:1.7">
        أدخل هذا الرمز في التطبيق لتعيين كلمة مرور جديدة.
      </div>
    </div>

    <div style="margin:26px 0;padding:20px;background:#f1ebff;border-radius:12px;text-align:center">
      <div style="font-size:34px;font-weight:700;letter-spacing:10px;color:#3d1580;font-family:monospace">{{ .Token }}</div>
    </div>

    <div dir="rtl" style="text-align:right;font-size:13.5px;color:#8a8a95;line-height:1.7">
      الرمز صالح لمدة ساعة واحدة. إذا لم تطلب إعادة التعيين فتجاهل هذه الرسالة، ولن تتغير كلمة مرورك.
    </div>

    <div style="height:1px;background:#e8e6ef;margin:26px 0"></div>

    <div dir="ltr" style="text-align:left">
      <div style="font-size:16px;font-weight:700;color:#16161c;margin-bottom:6px">Password reset code</div>
      <div style="font-size:14px;color:#5a5a66;line-height:1.7">
        Enter the code above in the app to set a new password.
        It is valid for one hour. If you did not request this, ignore this
        email and your password will not change.
      </div>
    </div>

    <div style="margin-top:26px;font-size:12px;color:#a5a4b0">Tenth Tone</div>
  </div>
</div>
```

---

## 3. Change email address

Used when someone changes their email in Settings. Same rule applies.

**Subject:** `رمز تأكيد البريد الجديد / Confirm your new email`

Use the **Confirm signup** template above, changing only the Arabic heading to
`تأكيد بريدك الإلكتروني الجديد` and the English one to `Confirm your new email`.

---

## Settings that must match

In **Authentication → Providers → Email**:

- **Confirm email: ON.** Without it Supabase creates the account instantly and
  never sends a code, so the OTP screen never appears.
- **OTP length: 6.** The app's OTP screen has exactly six boxes. An eight digit
  code silently fails every time, which already caught us once.
- **OTP expiry: 3600** seconds, matching the one hour stated in the emails above.

In **Project Settings → Authentication → SMTP Settings**:

| Field | Value |
| --- | --- |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | the Resend API key |
| Sender email | `no-reply@flyp-sa.com` |
| Sender name | `Tenth Tone` |

The sender domain must be the one verified in Resend, or every message is
rejected.
