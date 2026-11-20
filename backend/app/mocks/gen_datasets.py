"""Deterministic dataset generator for the AI layer.

Produces two committed artefacts:

* ``app/data/scam_dataset.jsonl`` — 240 labelled synthetic Pakistani messages
  (docs/07 §3.3): 90 clear scams, 90 legitimate, 35 hard negatives and 25
  ambiguous. Splits are assigned **per template family**, never per sample, so
  the held-out set cannot leak a template it was trained on.
* ``app/data/eval_cases.jsonl`` — 120 labelled benefit cases with independently
  injected noise, feeding EN's decision-router sweep (Challenge 01).

Run with::

    python -m app.mocks.gen_datasets --force

Everything is seeded (``20261120``) and every CNIC starts with ``99900``.
"""

from __future__ import annotations

import argparse
import json
import random
from collections.abc import Iterable, Sequence
from pathlib import Path
from typing import Any

from app.mocks import seed_data as sd

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SCAM_PATH = DATA_DIR / "scam_dataset.jsonl"
EVAL_PATH = DATA_DIR / "eval_cases.jsonl"
GENERATOR_SEED = 20261120

# --------------------------------------------------------------------------- #
# scam dataset — (family, lang, text)
# --------------------------------------------------------------------------- #
SCAM_FAMILIES: dict[str, list[tuple[str, str]]] = {
    "bisp_fee": [
        ("roman_ur", "BISP Ehsaas program se aap ko 25000 rupey mil rahe hain. Registration ke liye 500 rupey EasyPaisa 03001234567 par bhejen."),
        ("ur", "بے نظیر امدادی پروگرام سے آپ کو 25,000 روپے مل رہے ہیں۔ رجسٹریشن کے لیے 500 روپے ایزی پیسہ 03001234567 پر بھیجیں۔"),
        ("en", "You are eligible for Rs 25,000 under the BISP Ehsaas program. Send a Rs 500 registration fee to EasyPaisa 03001234567 to receive it."),
    ],
    "otp_phish": [
        ("roman_ur", "Aap ka bank account block ho jayega. Foran apna OTP 482913 hamein bataen taake account bach jaye."),
        ("ur", "آپ کا بینک اکاؤنٹ بلاک ہو جائے گا۔ فوراً اپنا او ٹی پی 482913 ہمیں بتائیں تاکہ اکاؤنٹ بچ جائے۔"),
        ("en", "Your bank account will be blocked today. Reply with your OTP 482913 immediately to keep it active."),
    ],
    "fake_code": [
        ("roman_ur", "Haqdaar: aap ki application HQ-2026-888888 approve ho gayi hai. Rs 25000 hasil karne ke liye 700 rupey bhejen."),
        ("ur", "حقدار: آپ کی درخواست HQ-2026-888888 منظور ہو گئی ہے۔ 25,000 روپے حاصل کرنے کے لیے 700 روپے بھیجیں۔"),
        ("en", "Haqdaar: application HQ-2026-888888 is approved. Pay Rs 700 processing fee to release Rs 25,000."),
    ],
    "code_mismatch": [
        ("roman_ur", "Haqdaar: aap ki application HQ-2026-000106 approve hui. Rs 50000 hasil karne ke liye is link par click karen bit.ly/hq-pay"),
        ("ur", "حقدار: آپ کی درخواست HQ-2026-000106 منظور ہوئی۔ 50,000 روپے حاصل کرنے کے لیے اس لنک پر کلک کریں bit.ly/hq-pay"),
        ("en", "Haqdaar: application HQ-2026-000106 approved. Click bit.ly/hq-pay and pay Rs 900 to receive Rs 50,000."),
    ],
    "short_link": [
        ("roman_ur", "Aap ki madad ki raqam tayyar hai. Ye link kholen bit.ly/relief-pay aur apni details darj karen."),
        ("ur", "آپ کی امداد کی رقم تیار ہے۔ یہ لنک کھولیں bit.ly/relief-pay اور اپنی تفصیلات درج کریں۔"),
        ("en", "Your relief payment is ready. Open bit.ly/relief-pay and enter your CNIC and PIN to collect it."),
    ],
    "amount_mismatch": [
        ("roman_ur", "Sarkar ne aap ko 80000 rupey ka relief diya hai. Rs 80000 lene ke liye 1000 rupey advance bhejen."),
        ("ur", "حکومت نے آپ کو 80,000 روپے کا ریلیف دیا ہے۔ 80,000 روپے لینے کے لیے 1,000 روپے ایڈوانس بھیجیں۔"),
        ("en", "The government has approved Rs 80,000 relief for you. Send Rs 1,000 advance to claim your Rs 80,000."),
    ],
    "urgency": [
        ("roman_ur", "Aaj aakhri din hai! Fori rabta karen warna aap ki application cancel ho jayegi. 03001234567 par WhatsApp karen."),
        ("ur", "آج آخری دن ہے! فوری رابطہ کریں ورنہ آپ کی درخواست منسوخ ہو جائے گی۔ 03001234567 پر واٹس ایپ کریں۔"),
        ("en", "Today is the last day. Contact immediately or your application will be cancelled. WhatsApp 03001234567 now."),
    ],
    "personal_number": [
        ("roman_ur", "Widow grant ke liye apply karna hai to 0300-9876543 par call karen. Sirf hum hi aap ka case chala sakte hain."),
        ("ur", "بیوہ گرانٹ کے لیے درخواست کرنی ہے تو 0300-9876543 پر کال کریں۔ صرف ہم ہی آپ کا کیس چلا سکتے ہیں۔"),
        ("en", "To apply for the widow grant call 0300-9876543. Only we can process your case, the office cannot."),
    ],
    "lottery": [
        ("roman_ur", "Mubarak ho! Aap ne 500000 rupey ka inaam jeeta hai. Inaam lene ke liye 2000 rupey ka tax bhejen."),
        ("ur", "مبارک ہو! آپ نے 5,00,000 روپے کا انعام جیتا ہے۔ انعام لینے کے لیے 2,000 روپے کا ٹیکس بھیجیں۔"),
        ("en", "Congratulations! You have won Rs 500,000. Send Rs 2,000 tax to release your prize money."),
    ],
    "nadra_block": [
        ("roman_ur", "NADRA ne aap ka CNIC block kar diya hai. 1500 rupey fees bhejen warna aap ka card hamesha ke liye band ho jayega."),
        ("ur", "نادرا نے آپ کا شناختی کارڈ بلاک کر دیا ہے۔ 1,500 روپے فیس بھیجیں ورنہ آپ کا کارڈ ہمیشہ کے لیے بند ہو جائے گا۔"),
        ("en", "NADRA has blocked your CNIC. Send Rs 1,500 fee now or your card will be permanently disabled."),
    ],
    "urdu_fee": [
        ("ur", "آپ کی بیوہ گرانٹ منظور ہو گئی ہے۔ رقم حاصل کرنے کے لیے 600 روپے پروسیسنگ فیس 03001112223 پر جمع کروائیں۔"),
        ("ur", "گزرا الاؤنس کے لیے 400 روپے رجسٹریشن فیس جمع کروائیں، ورنہ درخواست مسترد ہو جائے گی۔"),
        ("ur", "حقدار کی طرف سے اطلاع: 300 روپے فیس جمع کروائیں اور 15,000 روپے فوراً حاصل کریں۔"),
    ],
    "urdu_otp": [
        ("ur", "آپ کا شناختی کارڈ نمبر اور پن کوڈ بھیجیں تاکہ ہم آپ کی امداد جاری کر سکیں۔"),
        ("ur", "براہ کرم اپنا او ٹی پی 7712 بتائیں، ورنہ آپ کی رقم ضائع ہو جائے گی۔"),
        ("ur", "بینک کا کوڈ اور پاس ورڈ بھیجیں، ہم آپ کا اکاؤنٹ بحال کر دیں گے۔"),
    ],
    "english_fee": [
        ("en", "Your Haqdaar widow grant is approved. Pay a Rs 600 processing fee to account 03001112223 to receive PKR 13,000."),
        ("en", "Final notice: pay Rs 350 verification fee or your benefit application will be rejected permanently."),
        ("en", "Government relief of Rs 30,000 is reserved for you. Send Rs 800 registration charges to claim it."),
    ],
    "english_otp": [
        ("en", "Security alert: share your MPIN with our officer to unblock your payment of Rs 25,000."),
        ("en", "Your ATM PIN has expired. Reply with your current PIN and new PIN to reactivate your card."),
        ("en", "To receive your relief, send us the 6 digit code you just received by SMS."),
    ],
    "bank_verify": [
        ("roman_ur", "Aap ka bank account verify nahi hua. Is link par apni CNIC aur ATM PIN darj karen: tinyurl.com/verify-pk"),
        ("ur", "آپ کا بینک اکاؤنٹ تصدیق شدہ نہیں۔ اس لنک پر اپنا شناختی کارڈ اور اے ٹی ایم پن درج کریں: tinyurl.com/verify-pk"),
        ("en", "Your bank account is not verified. Enter your CNIC and ATM PIN at tinyurl.com/verify-pk to restore payments."),
    ],
    "zakat_scam": [
        ("roman_ur", "Zakat fund ke liye 5000 rupey jama karen, badle mein 50000 rupey ka relief milega. 03004445556 par bhejen."),
        ("ur", "زکوٰۃ فنڈ کے لیے 5,000 روپے جمع کریں، بدلے میں 50,000 روپے کا ریلیف ملے گا۔ 03004445556 پر بھیجیں۔"),
        ("en", "Donate Rs 5,000 to the Zakat fund and receive Rs 50,000 relief in return. Send to 03004445556."),
    ],
    "flood_relief": [
        ("roman_ur", "Sailab mutasireen ke liye 40000 rupey muawza. 900 rupey fees bhejen 03007778889 par, 24 ghante mein raqam milegi."),
        ("ur", "سیلاب متاثرین کے لیے 40,000 روپے معاوضہ۔ 900 روپے فیس بھیجیں 03007778889 پر، 24 گھنٹے میں رقم ملے گی۔"),
        ("en", "Flood compensation of Rs 40,000 approved. Send Rs 900 fee to 03007778889 and receive the amount within 24 hours."),
    ],
    "widow_grant_fee": [
        ("roman_ur", "Sahara widow grant ke liye aap ka naam shortlist hua hai. 550 rupey file charges bhejen taake payment release ho."),
        ("ur", "سہارا بیوہ گرانٹ کے لیے آپ کا نام شارٹ لسٹ ہوا ہے۔ 550 روپے فائل چارجز بھیجیں تاکہ ادائیگی جاری ہو۔"),
        ("en", "You are shortlisted for the Sahara widow grant. Send Rs 550 file charges so your payment can be released."),
    ],
    "sim_block": [
        ("roman_ur", "Aap ka SIM block ho jayega. 300 rupey bhejen 03006667778 par aur SIM chalu rakhen."),
        ("ur", "آپ کا سم بلاک ہو جائے گا۔ 300 روپے بھیجیں 03006667778 پر اور سم چالو رکھیں۔"),
        ("en", "Your SIM will be blocked in 2 hours. Send Rs 300 to 03006667778 to keep it active."),
    ],
    "easypaisa_reverse": [
        ("roman_ur", "Aap ne ghalti se mere account mein 3000 rupey bhej diye hain. Foran wapas bhejen 03005556667 par."),
        ("ur", "آپ نے غلطی سے میرے اکاؤنٹ میں 3,000 روپے بھیج دیے ہیں۔ فوراً واپس بھیجیں 03005556667 پر۔"),
        ("en", "You accidentally sent me Rs 3,000. Send it back immediately to 03005556667 or I will report you."),
    ],
    "job_offer": [
        ("roman_ur", "Sarkari naukri ka mauqa! 1500 rupey registration fee bhejen aur 35000 rupey tankhwah wali job payen."),
        ("ur", "سرکاری نوکری کا موقع! 1,500 روپے رجسٹریشن فیس بھیجیں اور 35,000 روپے تنخواہ والی نوکری پائیں۔"),
        ("en", "Government job offer. Pay Rs 1,500 registration fee and get a job with Rs 35,000 salary."),
    ],
    "medical_relief": [
        ("roman_ur", "Ilaj ke liye 60000 rupey ka medical grant. 1200 rupey file fee bhejen 03003334445 par."),
        ("ur", "علاج کے لیے 60,000 روپے کا میڈیکل گرانٹ۔ 1,200 روپے فائل فیس بھیجیں 03003334445 پر۔"),
        ("en", "Medical grant of Rs 60,000 approved for your treatment. Send Rs 1,200 file fee to 03003334445."),
    ],
    "ration_card": [
        ("roman_ur", "Rashan card banwane ke liye 450 rupey card fee bhejen, warna aap ka naam list se nikal jayega."),
        ("ur", "راشن کارڈ بنوانے کے لیے 450 روپے کارڈ فیس بھیجیں، ورنہ آپ کا نام فہرست سے نکل جائے گا۔"),
        ("en", "Pay Rs 450 card fee to receive your ration card, otherwise your name will be removed from the list."),
    ],
    "bijli_relief": [
        ("roman_ur", "Bijli bill relief ke liye 250 rupey fees bhejen aur 15000 rupey ka bill maaf karwaen."),
        ("ur", "بجلی بل ریلیف کے لیے 250 روپے فیس بھیجیں اور 15,000 روپے کا بل معاف کروائیں۔"),
        ("en", "Send Rs 250 fee to get Rs 15,000 waived off your electricity bill under the relief scheme."),
    ],
    "child_support": [
        ("roman_ur", "Bachon ke liye 20000 rupey child support. 800 rupey verification charges bhejen 03002223334 par."),
        ("ur", "بچوں کے لیے 20,000 روپے چائلڈ سپورٹ۔ 800 روپے تصدیقی چارجز بھیجیں 03002223334 پر۔"),
        ("en", "Child support of Rs 20,000 approved. Send Rs 800 verification charges to 03002223334."),
    ],
    "govt_sms_spoof": [
        ("roman_ur", "Sarkari notice: aap ki madad ki raqam rok di gayi hai. 700 rupey bhejen taake raqam jari ho jaye."),
        ("ur", "سرکاری نوٹس: آپ کی امداد کی رقم روک دی گئی ہے۔ 700 روپے بھیجیں تاکہ رقم جاری ہو جائے۔"),
        ("en", "Government notice: your relief payment is on hold. Send Rs 700 to release it immediately."),
    ],
    "whatsapp_group": [
        ("roman_ur", "Relief group join karen, wahan se 30000 rupey ka form milega. 500 rupey group fee bhejen."),
        ("ur", "ریلیف گروپ جوائن کریں، وہاں سے 30,000 روپے کا فارم ملے گا۔ 500 روپے گروپ فیس بھیجیں۔"),
        ("en", "Join our relief WhatsApp group to get the Rs 30,000 form. Send Rs 500 group fee to be added."),
    ],
    "cnic_update": [
        ("roman_ur", "CNIC update ke liye 350 rupey fees bhejen 03009990001 par, warna aap ka card expire ho jayega."),
        ("ur", "شناختی کارڈ اپ ڈیٹ کے لیے 350 روپے فیس بھیجیں 03009990001 پر، ورنہ آپ کا کارڈ ختم ہو جائے گا۔"),
        ("en", "Pay Rs 350 CNIC update fee to 03009990001 or your card will expire and benefits will stop."),
    ],
    "pension_scam": [
        ("roman_ur", "Pension verification ke liye apna CNIC number aur bank account number 03008887776 par WhatsApp karen."),
        ("ur", "پنشن تصدیق کے لیے اپنا شناختی کارڈ نمبر اور بینک اکاؤنٹ نمبر 03008887776 پر واٹس ایپ کریں۔"),
        ("en", "For pension verification WhatsApp your CNIC and bank account number to 03008887776 today."),
    ],
    "qr_scam": [
        ("roman_ur", "Raqam receive karne ke liye ye QR scan karen aur apna PIN darj karen. Rs 25000 aap ke account mein aayenge."),
        ("ur", "رقم وصول کرنے کے لیے یہ کیو آر اسکین کریں اور اپنا پن درج کریں۔ 25,000 روپے آپ کے اکاؤنٹ میں آئیں گے۔"),
        ("en", "Scan this QR and enter your PIN to receive Rs 25,000. Do not share the code with anyone else."),
    ],
}

LEGIT_FAMILIES: dict[str, list[tuple[str, str]]] = {
    "haqdaar_official": [
        ("roman_ur", "Haqdaar: aap ki application HQ-2026-000106 approve hui hai, PKR 13,000. Verification code 482913. Apna PIN kisi ko na bataen."),
        ("ur", "حقدار: آپ کی درخواست HQ-2026-000106 منظور ہوئی، 13,000 روپے۔ تصدیقی کوڈ 482913۔ اپنا پن کسی کو نہ بتائیں۔"),
        ("en", "Haqdaar: your application HQ-2026-000106 is approved for PKR 13,000. Verification code 482913. Never share your PIN."),
    ],
    "bank_debit_alert": [
        ("roman_ur", "Aap ke account se Rs 2,500 debit hue. Balance Rs 18,400. Ye transaction aap ne nahi ki to branch se rabta karen."),
        ("ur", "آپ کے اکاؤنٹ سے 2,500 روپے کٹے۔ بیلنس 18,400 روپے۔ اگر یہ لین دین آپ نے نہیں کیا تو برانچ سے رابطہ کریں۔"),
        ("en", "Rs 2,500 debited from your account. Balance Rs 18,400. If this was not you, contact your branch."),
    ],
    "bank_credit_alert": [
        ("roman_ur", "Aap ke account mein Rs 13,000 jama ho gaye hain. Haqdaar grant payment. Shukriya."),
        ("ur", "آپ کے اکاؤنٹ میں 13,000 روپے جمع ہو گئے ہیں۔ حقدار گرانٹ کی ادائیگی۔ شکریہ۔"),
        ("en", "Rs 13,000 credited to your account. Haqdaar grant payment. Thank you."),
    ],
    "shopkeeper_ledger": [
        ("roman_ur", "Ammi, dukan ka hisab: 4,500 rupey baqi hain. Mahine ke aakhir tak de den."),
        ("ur", "امی، دکان کا حساب: 4,500 روپے باقی ہیں۔ مہینے کے آخر تک دے دیں۔"),
        ("en", "Aunty, shop ledger: Rs 4,500 outstanding. Please settle by the end of the month."),
    ],
    "family_transfer": [
        ("roman_ur", "Bhai, 3,000 rupey bhej diye hain. Mil gaye to bata dena."),
        ("ur", "بھائی، 3,000 روپے بھیج دیے ہیں۔ مل گئے تو بتا دینا۔"),
        ("en", "Brother, I have sent Rs 3,000. Let me know when it arrives."),
    ],
    "utility_bill": [
        ("roman_ur", "Aap ka bijli ka bill Rs 3,200 hai, due date 28 November. HBL ya Easypaisa se jama karwa sakte hain."),
        ("ur", "آپ کا بجلی کا بل 3,200 روپے ہے، آخری تاریخ 28 نومبر۔ ایچ بی ایل یا ایزی پیسہ سے جمع کروا سکتے ہیں۔"),
        ("en", "Your electricity bill is Rs 3,200, due 28 November. You can pay via HBL or Easypaisa."),
    ],
    "doctor_appointment": [
        ("roman_ur", "Doctor sahib ne 25 November ko 11 baje appointment di hai. Fees 1,500 rupey counter par jama karen."),
        ("ur", "ڈاکٹر صاحب نے 25 نومبر کو 11 بجے اپائنٹمنٹ دی ہے۔ فیس 1,500 روپے کاؤنٹر پر جمع کریں۔"),
        ("en", "Your appointment with the doctor is on 25 November at 11 am. Please pay the Rs 1,500 fee at the counter."),
    ],
    "school_fee": [
        ("roman_ur", "Bachon ki school fee 2,500 rupey mahana hai. Is hafte jama karwa den."),
        ("ur", "بچوں کی اسکول فیس 2,500 روپے ماہانہ ہے۔ اس ہفتے جمع کروا دیں۔"),
        ("en", "The children's school fee is Rs 2,500 per month. Please submit it this week."),
    ],
    "employer_wage": [
        ("roman_ur", "Is mahine ki mazdoori 12,000 rupey bhej di hai. 6 din ka hisab hai."),
        ("ur", "اس مہینے کی مزدوری 12,000 روپے بھیج دی ہے۔ 6 دن کا حساب ہے۔"),
        ("en", "I have sent this month's wages of Rs 12,000 for six days of work."),
    ],
    "office_hours": [
        ("roman_ur", "Zakat o Behbood Board office somwar se jumerat 9 se 2 baje tak khula hai. Koi fees nahi hai."),
        ("ur", "زکوٰۃ و بہبود بورڈ کا دفتر پیر سے جمعرات 9 سے 2 بجے تک کھلا ہے۔ کوئی فیس نہیں ہے۔"),
        ("en", "The Zakat and Welfare Board office is open Monday to Thursday, 9 am to 2 pm. There is no fee."),
    ],
    "weather_warning": [
        ("roman_ur", "Kal Thatta mein tez hawa aur barish ka imkaan hai. Kachi abadi ke log ehtiyat karen."),
        ("ur", "کل ٹھٹھہ میں تیز ہوا اور بارش کا امکان ہے۔ کچی آبادی کے لوگ احتیاط کریں۔"),
        ("en", "Strong winds and rain are expected in Thatta tomorrow. Residents of low-lying areas should take care."),
    ],
    "haqdaar_status": [
        ("roman_ur", "Haqdaar: aap ki application HQ-2026-000105 abhi officer ke paas hai. Aap ko kuch karna nahi hai."),
        ("ur", "حقدار: آپ کی درخواست HQ-2026-000105 ابھی افسر کے پاس ہے۔ آپ کو کچھ کرنا نہیں ہے۔"),
        ("en", "Haqdaar: your application HQ-2026-000105 is with an officer. You do not need to do anything."),
    ],
    "haqdaar_otp": [
        ("roman_ur", "Haqdaar: aap ka login OTP 731904 hai. Ye code 5 minute ke liye hai. Kisi ko na bataen."),
        ("ur", "حقدار: آپ کا لاگ ان او ٹی پی 731904 ہے۔ یہ کوڈ 5 منٹ کے لیے ہے۔ کسی کو نہ بتائیں۔"),
        ("en", "Haqdaar: your login OTP is 731904. It expires in 5 minutes. Do not share it with anyone."),
    ],
    "pharmacy": [
        ("roman_ur", "Aap ki dawai tayyar hai, dukan se le jayen. Rs 850 ka bill hai."),
        ("ur", "آپ کی دوا تیار ہے، دکان سے لے جائیں۔ 850 روپے کا بل ہے۔"),
        ("en", "Your medicine is ready for pickup. The bill is Rs 850."),
    ],
    "transport": [
        ("roman_ur", "Thatta se Karachi ki bus subah 7 baje chalti hai, kiraya 450 rupey hai."),
        ("ur", "ٹھٹھہ سے کراچی کی بس صبح 7 بجے چلتی ہے، کرایہ 450 روپے ہے۔"),
        ("en", "The Thatta to Karachi bus leaves at 7 am. The fare is Rs 450."),
    ],
    "crop_advice": [
        ("roman_ur", "Gandum ki kasht ke liye beej 40 kilo fi acre istemal karen. Zyada maloomat ke liye Zirat office jayen."),
        ("ur", "گندم کی کاشت کے لیے بیج 40 کلو فی ایکڑ استعمال کریں۔ زیادہ معلومات کے لیے زراعت دفتر جائیں۔"),
        ("en", "Use 40 kg of wheat seed per acre. Visit the agriculture office for more guidance."),
    ],
    "vaccination": [
        ("roman_ur", "Bachon ko polio ke qatre 24 November ko ghar par pilaye jayenge. Ye muft hai."),
        ("ur", "بچوں کو پولیو کے قطرے 24 نومبر کو گھر پر پلائے جائیں گے۔ یہ مفت ہے۔"),
        ("en", "Polio drops will be given at your home on 24 November. This is free of charge."),
    ],
    "ration_distribution": [
        ("roman_ur", "Rashan ki taqseem 26 November ko union council office par hogi. Card sath laayen, koi fees nahi."),
        ("ur", "راشن کی تقسیم 26 نومبر کو یونین کونسل دفتر پر ہوگی۔ کارڈ ساتھ لائیں، کوئی فیس نہیں۔"),
        ("en", "Ration distribution is on 26 November at the union council office. Bring your card, there is no fee."),
    ],
    "court_notice": [
        ("roman_ur", "Aap ka case 2 December ko subah 9 baje court number 3 mein pesh hoga. Wakeel sath laayen."),
        ("ur", "آپ کا کیس 2 دسمبر کو صبح 9 بجے کورٹ نمبر 3 میں پیش ہوگا۔ وکیل ساتھ لائیں۔"),
        ("en", "Your case is listed on 2 December at 9 am in court room 3. Please bring your lawyer."),
    ],
    "land_record": [
        ("roman_ur", "Aap ke plot ka record office mein dastiyab hai. 200 rupey official fee hai, receipt milegi."),
        ("ur", "آپ کے پلاٹ کا ریکارڈ دفتر میں دستیاب ہے۔ 200 روپے سرکاری فیس ہے، رسید ملے گی۔"),
        ("en", "Your plot record is available at the office. The official fee is Rs 200 and you will get a receipt."),
    ],
    "marriage_hall": [
        ("roman_ur", "Shaadi hall ki booking 15,000 rupey advance par confirm hogi. Advance receipt zaroori hai."),
        ("ur", "شادی ہال کی بکنگ 15,000 روپے ایڈوانس پر کنفرم ہوگی۔ ایڈوانس رسید ضروری ہے۔"),
        ("en", "The marriage hall booking is confirmed with a Rs 15,000 advance. An advance receipt is required."),
    ],
    "tailor_order": [
        ("roman_ur", "Aap ke kapre tayyar hain. 1,200 rupey silai ke baqi hain."),
        ("ur", "آپ کے کپڑے تیار ہیں۔ 1,200 روپے سلائی کے باقی ہیں۔"),
        ("en", "Your clothes are ready. Rs 1,200 is outstanding for the stitching."),
    ],
    "livestock": [
        ("roman_ur", "Bakri ka rate 45,000 rupey hai. Pasand aaye to bata den."),
        ("ur", "بکری کا ریٹ 45,000 روپے ہے۔ پسند آئے تو بتا دیں۔"),
        ("en", "The goat is priced at Rs 45,000. Let me know if you are interested."),
    ],
    "mobile_topup": [
        ("roman_ur", "Aap ke number par 500 rupey ka balance load ho gaya hai. Shukriya."),
        ("ur", "آپ کے نمبر پر 500 روپے کا بیلنس لوڈ ہو گیا ہے۔ شکریہ۔"),
        ("en", "Rs 500 balance has been loaded on your number. Thank you."),
    ],
    "insurance": [
        ("roman_ur", "Aap ki sehat bima policy active hai. Aspatal mein card dikhayen, ilaj muft hoga."),
        ("ur", "آپ کی صحت بیمہ پالیسی فعال ہے۔ اسپتال میں کارڈ دکھائیں، علاج مفت ہوگا۔"),
        ("en", "Your health insurance policy is active. Show the card at the hospital for free treatment."),
    ],
    "ngo_awareness": [
        ("roman_ur", "Kisi ko apna OTP ya PIN na bataen. Haqdaar kabhi paise nahi mangta. Ye sarkari hidayat hai."),
        ("ur", "کسی کو اپنا او ٹی پی یا پن نہ بتائیں۔ حقدار کبھی پیسے نہیں مانگتا۔ یہ سرکاری ہدایت ہے۔"),
        ("en", "Never share your OTP or PIN. Haqdaar never asks for money. This is an official advisory."),
    ],
    "police_helpline": [
        ("roman_ur", "Kisi bhi fraud ki shikayat ke liye 15 par call karen. Koi fees nahi hai."),
        ("ur", "کسی بھی فراڈ کی شکایت کے لیے 15 پر کال کریں۔ کوئی فیس نہیں ہے۔"),
        ("en", "Call 15 to report any fraud. There is no fee."),
    ],
    "water_supply": [
        ("roman_ur", "Mohalle mein paani kal subah 6 se 9 baje tak aayega."),
        ("ur", "محلے میں پانی کل صبح 6 سے 9 بجے تک آئے گا۔"),
        ("en", "Water supply in the neighbourhood will be available tomorrow from 6 to 9 am."),
    ],
    "exam_result": [
        ("roman_ur", "Bachon ka result 30 November ko school ki notice board par lagega."),
        ("ur", "بچوں کا رزلٹ 30 نومبر کو اسکول کے نوٹس بورڈ پر لگے گا۔"),
        ("en", "The children's results will be posted on the school notice board on 30 November."),
    ],
    "eid_greeting": [
        ("roman_ur", "Eid Mubarak! Allah aap ko khush rakhe. Ghar walon ko salam kehna."),
        ("ur", "عید مبارک! اللہ آپ کو خوش رکھے۔ گھر والوں کو سلام کہنا۔"),
        ("en", "Eid Mubarak! May Allah keep you happy. Give my regards to the family."),
    ],
}

HARD_NEGATIVES: list[tuple[str, str, str]] = [
    ("roman_ur", "Bhai 15,000 rupey bhej dena, account number 03001234567 hai. Kal wapas kar dunga.", "family money request"),
    ("roman_ur", "Aap ke account mein 25,000 rupey jama ho gaye hain. Balance check kar len.", "credit alert"),
    ("roman_ur", "Bank ne OTP bheja hai, apne tak rakhen, kisi ko na bataen.", "safety advice mentioning OTP"),
    ("roman_ur", "Rs 5,000 ki payment receive ho gayi. Shukriya.", "payment confirmation"),
    ("roman_ur", "PIN change karne ke liye branch tashreefat laayen, koi fees nahi.", "branch instruction mentioning PIN"),
    ("roman_ur", "Aap ka Easypaisa balance 1,200 rupey hai.", "balance enquiry"),
    ("roman_ur", "Registration fee 200 rupey hai, receipt zaroor le len.", "legitimate fee with receipt"),
    ("roman_ur", "Loan installment 8,000 rupey due hai, 5 tareekh tak jama karen.", "loan reminder"),
    ("roman_ur", "Salary 30,000 rupey transfer ho gayi hai.", "salary credit"),
    ("roman_ur", "Zakat 5,000 rupey diye hain, Allah qabool kare.", "charity given"),
    ("roman_ur", "Ammi 3,000 rupey bhej diye hain, mil gaye?", "family transfer"),
    ("roman_ur", "Dukan ka hisab: 4,500 rupey baqi hain.", "shop ledger"),
    ("roman_ur", "Bank account number update karwa len branch se, koi charge nahi.", "account update advice"),
    ("roman_ur", "Aap ka card block nahi hua, ye afwah hai. Branch ja kar tasdeeq karwa len.", "rumour rebuttal"),
    ("roman_ur", "Mera PIN bhool gaya, branch ja kar reset karwana hai.", "forgotten PIN"),
    ("roman_ur", "Rs 80,000 ka cheque clear ho gaya hai.", "cheque clearance"),
    ("roman_ur", "Bijli ka bill 3,200 rupey aa gaya hai, 28 tareekh tak jama karen.", "utility bill"),
    ("roman_ur", "Mobile recharge 500 rupey kar diya hai.", "topup"),
    ("roman_ur", "School fee 2,500 rupey jama karwa den.", "school fee"),
    ("roman_ur", "Doctor ki fees 1,500 rupey hai, counter par jama karen.", "doctor fee"),
    ("roman_ur", "Aap ko 25,000 rupey ka qarz dena hai, yaad dila raha hoon.", "debt reminder"),
    ("roman_ur", "Transfer successful: PKR 12,000 to Ali Raza.", "transfer receipt"),
    ("roman_ur", "Aap ka OTP 482913 hai. Kisi ko na bataen.", "legitimate OTP delivery"),
    ("roman_ur", "Bank helpline 111-111-111 par call karen, apna PIN kabhi na bataen.", "helpline with safety warning"),
    ("roman_ur", "Rs 15,000 relief amount aap ke account mein aana hai, form office mein jama karwa len.", "relief info without fee"),
    ("roman_ur", "Haqdaar: aap ki application HQ-2026-000106 approve hui, PKR 13,000. Code 482913.", "official message"),
    ("roman_ur", "Payment failed ho gayi, dobara koshish karen.", "payment failure"),
    ("roman_ur", "Account dormant hai, branch se activate karwaen, koi fees nahi.", "dormant account advice"),
    ("roman_ur", "Aap ne ghalti se 2,000 rupey bhej diye, wapas kar den.", "genuine reversal request"),
    ("roman_ur", "Easypaisa se Easypaisa transfer free hai is mahine.", "promo"),
    ("roman_ur", "JazzCash balance check karne ke liye *111# dial karen.", "USSD code"),
    ("roman_ur", "Committee ki qist 5,000 rupey is mahine ki hai.", "committee instalment"),
    ("roman_ur", "Mazdoori 1,200 rupey roz, 6 din ka 7,200 rupey banta hai.", "wage calculation"),
    ("roman_ur", "Bhai, 500 rupey udhar de dena, kal wapas kar dunga.", "small loan request"),
    ("roman_ur", "Bank statement mein 45,000 rupey ka credit dikh raha hai.", "statement reading"),
]

AMBIGUOUS: list[tuple[str, str, str]] = [
    ("roman_ur", "Bhai payment bhej dena", "no amount, no context"),
    ("roman_ur", "Aap ke liye 10,000 rupey ki madad available hai, rabta karen.", "no fee, no link"),
    ("roman_ur", "Haqdaar se rabta karen.", "too short"),
    ("roman_ur", "Payment?", "too short"),
    ("roman_ur", "Government scheme, details ke liye call karen 0300-1234567.", "personal number, no fee"),
    ("roman_ur", "Aap ki application ke bare mein maloomat chahiye.", "vague"),
    ("roman_ur", "Relief mil sakti hai, kya aap interested hain?", "vague offer"),
    ("roman_ur", "CNIC number bhejen.", "asks for CNIC, no context"),
    ("roman_ur", "Aap ka account verify karna hai.", "vague verification"),
    ("roman_ur", "Kya aap ne form jama kiya tha?", "question only"),
    ("roman_ur", "Rs 25,000", "amount only"),
    ("roman_ur", "Madad chahiye to batayen.", "vague offer"),
    ("roman_ur", "Sarkari scheme ka faida uthayen.", "generic marketing"),
    ("roman_ur", "Aap ka number hamare record mein hai.", "vague"),
    ("en", "Please contact us.", "too short"),
    ("ur", "آپ کے لیے امداد دستیاب ہے۔", "vague offer"),
    ("ur", "رقم بھیج دیں۔", "no amount, no context"),
    ("ur", "تفصیلات کے لیے رابطہ کریں۔", "vague"),
    ("roman_ur", "Aap ka form pending hai.", "status without detail"),
    ("en", "Verification required.", "too short"),
    ("roman_ur", "Kuch maloomat chahiye thi.", "vague"),
    ("roman_ur", "Aap ko Rs 5,000 mil sakte hain.", "vague amount"),
    ("roman_ur", "Office se call aayega.", "vague"),
    ("roman_ur", "WhatsApp par baat karen.", "channel only"),
    ("roman_ur", "Aap ka case update hua hai.", "status without detail"),
]


# --------------------------------------------------------------------------- #
# scam dataset builder
# --------------------------------------------------------------------------- #
def _split_for(family: str, index: int) -> str:
    """Assign the split per family so templates never straddle train/test."""
    return "test" if index % 5 == 4 else "train"


def build_scam_dataset() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    counter = 0

    def add(
        *,
        bucket: str,
        label: str,
        family: str,
        lang: str,
        text: str,
        notes: str,
        split: str,
    ) -> None:
        nonlocal counter
        counter += 1
        rows.append(
            {
                "id": f"scam_{counter:03d}",
                "bucket": bucket,
                "label": label,
                "family": family,
                "lang": lang,
                "text": text,
                "split": split,
                "notes": notes,
            }
        )

    for index, (family, variants) in enumerate(SCAM_FAMILIES.items()):
        split = _split_for(family, index)
        for lang, text in variants:
            add(
                bucket="CLEAR_SCAM",
                label="SCAM",
                family=family,
                lang=lang,
                text=text,
                notes="clear relief/fee/OTP scam",
                split=split,
            )

    for index, (family, variants) in enumerate(LEGIT_FAMILIES.items()):
        split = _split_for(family, index + 2)
        for lang, text in variants:
            add(
                bucket="LEGITIMATE",
                label="LEGIT",
                family=family,
                lang=lang,
                text=text,
                notes="benign official or personal message",
                split=split,
            )

    for index, (lang, text, note) in enumerate(HARD_NEGATIVES):
        add(
            bucket="HARD_NEGATIVE",
            label="LEGIT",
            family=f"hard_negative_{index + 1:02d}",
            lang=lang,
            text=text,
            notes=note,
            split="test" if index % 5 == 4 else "train",
        )

    for index, (lang, text, note) in enumerate(AMBIGUOUS):
        add(
            bucket="AMBIGUOUS",
            label="AMBIGUOUS",
            family=f"ambiguous_{index + 1:02d}",
            lang=lang,
            text=text,
            notes=note,
            split="test" if index % 5 == 4 else "train",
        )

    return rows


# --------------------------------------------------------------------------- #
# eval cases (Challenge 01 honesty engine)
# --------------------------------------------------------------------------- #
NOISE_KINDS = (
    "SPELLING_DRIFT",
    "MISSING_FIELD",
    "INCOME_CONFLICT",
    "FORGED_DOC",
    "VERBAL_CONSENT",
    "SUBTLE_FRAUD",
    "DISTRICT_TYPO",
    "CNIC_EXPIRED",
    "DECEASED_SPOUSE_UNVERIFIED",
    "LOW_QUALITY_DOC",
)

ELIGIBLE_DISTRICTS = ("Thatta", "Badin", "Hyderabad", "Karachi", "Tharparkar", "Umerkot", "Mirpurkhas", "Sukkur", "Larkana", "Dadu")
INELIGIBLE_DISTRICTS = ("Jamshoro", "Matiari", "Shikarpur", "Ghotki", "Jacobabad")

NAME_DRIFTS = {
    "Fatima Bibi": ["Fatma Bibi", "Fatima Beebi", "Mst. Fatima Bibi", "Fatima bibi"],
    "Sakina Bibi": ["Sakina Beebi", "Sakeena Bibi", "Mst. Sakina Bibi"],
    "Zainab Bibi": ["Zainab Beebi", "Zainab Bibi.", "Zaineb Bibi"],
    "Nasreen Bibi": ["Nasrin Bibi", "Nasreen Beebi"],
    "Shahida Bibi": ["Shahida Beebi", "Shaheeda Bibi"],
    "Razia Bibi": ["Razia Beebi", "Razya Bibi"],
}


def _fact(value: Any, source: str, confidence: float, *, entered_by: str = "SYSTEM") -> dict[str, Any]:
    return {
        "state": "KNOWN",
        "value": value,
        "source": source,
        "source_confidence": round(confidence, 3),
        "entered_by": entered_by,
        "alternatives": [],
        "conflict": False,
        "missing_reason": None,
    }


def _unknown(reason: str = "USER_UNKNOWN") -> dict[str, Any]:
    return {
        "state": "UNKNOWN",
        "value": None,
        "source": None,
        "source_confidence": 0.0,
        "entered_by": "CITIZEN",
        "alternatives": [],
        "conflict": False,
        "missing_reason": reason,
    }


def _is_eligible(facts: dict[str, Any]) -> bool:
    """Evaluate the frozen docs/06 §2.1 eligibility rules against a fact snapshot.

    ``children_under_18`` is deliberately absent: R09_CHILDREN_KNOWN (ADR-015)
    gates the *amount*, not eligibility. A citizen whose children count is unknown
    is still genuinely eligible — the engine routes ASK_MORE/HUMAN_REVIEW instead
    of approving, and the ground-truth label must not pretend otherwise.
    """
    checks = {
        "applicant_is_alive": lambda v: v is True,
        "applicant_cnic_valid": lambda v: v is True,
        "applicant_age_years": lambda v: v >= 18,
        "spouse_death_verified": lambda v: v is True,
        "monthly_income_pkr": lambda v: v <= 40000,
        "has_conflicting_active_grant": lambda v: v is False,
        "applicant_district": lambda v: v in ELIGIBLE_DISTRICTS,
        "cnic_doc_verified": lambda v: v is True,
    }
    for key, predicate in checks.items():
        fact = facts.get(key)
        if not fact or fact["state"] != "KNOWN":
            return False
        if not predicate(fact["value"]):
            return False
    return True


def _amount(children: int) -> int:
    """docs/06 §2.1 ``benefit_formula``: 12,000 + 1,000/child (max 5), cap 20,000."""
    counted = min(max(0, children), 5)
    return min(12000 + 1000 * counted, 20000)


def build_eval_cases() -> list[dict[str, Any]]:
    rng = random.Random(GENERATOR_SEED)
    rows: list[dict[str, Any]] = []
    names = list(NAME_DRIFTS)

    for index in range(120):
        case_number = index + 1
        name = names[index % len(names)]
        children = index % 6
        income = rng.choice([12000, 15000, 18000, 22000, 26000, 28000, 31000, 34000, 38000, 40000, 42000, 46000, 52000])
        district = ELIGIBLE_DISTRICTS[index % len(ELIGIBLE_DISTRICTS)]
        age = rng.choice([19, 24, 29, 34, 41, 47, 53, 61])
        alive = True
        cnic_valid = True
        spouse_verified = True
        conflicting = False
        cnic_doc_verified = True
        noise: list[str] = []

        # Deterministic noise injection — independent of the eligibility truth.
        if index % 7 == 0:
            noise.append("SPELLING_DRIFT")
        if index % 11 == 0:
            noise.append("MISSING_FIELD")
        if index % 9 == 0:
            noise.append("INCOME_CONFLICT")
        if index % 13 == 0:
            noise.append("FORGED_DOC")
            cnic_doc_verified = False
        if index % 8 == 0:
            noise.append("VERBAL_CONSENT")
        if index % 17 == 0:
            noise.append("SUBTLE_FRAUD")
            conflicting = True
        if index % 15 == 0:
            noise.append("DISTRICT_TYPO")
        if index % 19 == 0:
            noise.append("CNIC_EXPIRED")
            cnic_valid = False
        if index % 23 == 0:
            noise.append("DECEASED_SPOUSE_UNVERIFIED")
            spouse_verified = False
        if index % 21 == 0:
            noise.append("LOW_QUALITY_DOC")

        # A slice of cases is genuinely ineligible on the merits.
        if index % 6 == 3:
            income = rng.choice([44000, 48000, 55000, 62000])
        if index % 10 == 7:
            district = INELIGIBLE_DISTRICTS[index % len(INELIGIBLE_DISTRICTS)]
        if index % 29 == 5:
            alive = False

        declared_name = name
        if "SPELLING_DRIFT" in noise:
            declared_name = NAME_DRIFTS[name][index % len(NAME_DRIFTS[name])]

        facts: dict[str, Any] = {
            "applicant_cnic": _fact(sd.cnic(900 + index), "DOCUMENT_QR", 0.97),
            "applicant_full_name": _fact(declared_name, "IDENTITY_REGISTRY", 0.93 if "SPELLING_DRIFT" not in noise else 0.71),
            "applicant_dob": _fact(f"{2026 - age}-04-12", "IDENTITY_REGISTRY", 0.95),
            "applicant_age_years": _fact(age, "IDENTITY_REGISTRY", 0.95),
            "applicant_is_alive": _fact(alive, "IDENTITY_REGISTRY", 0.99),
            "applicant_cnic_valid": _fact(cnic_valid, "IDENTITY_REGISTRY", 0.98),
            "applicant_district": _fact(district, "SELF_DECLARED", 0.95, entered_by="CITIZEN"),
            "marital_status_widow": _fact(True, "CIVIL_REGISTRY", 0.96),
            "spouse_death_verified": _fact(spouse_verified, "CIVIL_REGISTRY", 0.96),
            "spouse_full_name": _fact("Ghulam Rasool", "SELF_DECLARED", 0.90, entered_by="CITIZEN"),
            "spouse_cnic": _fact(sd.cnic(500 + index), "CIVIL_REGISTRY", 0.95),
            "children_under_18": _fact(children, "SELF_DECLARED", 0.93, entered_by="CITIZEN"),
            "household_size": _fact(children + 2, "HOUSEHOLD_SURVEY", 0.92),
            "monthly_income_pkr": _fact(income, "HOUSEHOLD_SURVEY", 0.92),
            "poverty_score": _fact(min(95, 20 + index % 60), "HOUSEHOLD_SURVEY", 0.90),
            "has_conflicting_active_grant": _fact(conflicting, "BENEFITS_REGISTRY", 0.95),
            "payout_phone": _fact(f"+9230010{index:05d}", "SELF_DECLARED", 0.95, entered_by="CITIZEN"),
            "cnic_doc_verified": _fact(cnic_doc_verified, "DOCUMENT_VERIFIER", 0.94),
            "death_cert_doc_verified": _fact(spouse_verified, "DOCUMENT_VERIFIER", 0.93),
            "citizen_has_active_dept_consent": _fact(True, "CONSENT_ENGINE", 1.0),
        }

        if "INCOME_CONFLICT" in noise:
            declared = max(8000, income - rng.choice([8000, 12000, 16000]))
            facts["monthly_income_pkr"]["alternatives"] = [
                {"value": declared, "source": "SELF_DECLARED", "entered_by": "CITIZEN"}
            ]
            facts["monthly_income_pkr"]["conflict"] = True

        if "MISSING_FIELD" in noise:
            facts["children_under_18"] = _unknown()

        if "DISTRICT_TYPO" in noise:
            facts["applicant_district"] = _fact(
                district.replace("a", "aa", 1), "SELF_DECLARED", 0.62, entered_by="CITIZEN"
            )

        consent_assurance = 0.82 if "VERBAL_CONSENT" in noise else 1.0
        truly_eligible = _is_eligible(facts)
        children_unknown = facts["children_under_18"]["state"] != "KNOWN"

        rows.append(
            {
                "case_id": f"EVAL-{case_number:04d}",
                "program_code": "SAHARA_WIDOW_GRANT",
                "split": "test" if index % 5 == 4 else "train",
                "noise": noise,
                "consent_assurance": consent_assurance,
                "truly_eligible": truly_eligible,
                # ADR-015: an unknown children count makes the amount undetermined,
                # so no amount is asserted and the case must not auto-approve.
                "children_unknown": children_unknown,
                "expected_amount_pkr": (
                    _amount(children) if truly_eligible and not children_unknown else None
                ),
                "facts": facts,
                "notes": "synthetic case; noise injected independently of the eligibility truth",
            }
        )

    return rows


# --------------------------------------------------------------------------- #
# CLI
# --------------------------------------------------------------------------- #
def _write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
            count += 1
    return count


def generate(*, force: bool = False) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    if force or not SCAM_PATH.exists():
        rows = build_scam_dataset()
        summary["scam_dataset"] = _write_jsonl(SCAM_PATH, rows)
        buckets: dict[str, int] = {}
        for row in rows:
            buckets[row["bucket"]] = buckets.get(row["bucket"], 0) + 1
        summary["scam_buckets"] = buckets
    if force or not EVAL_PATH.exists():
        cases = build_eval_cases()
        summary["eval_cases"] = _write_jsonl(EVAL_PATH, cases)
        summary["eval_eligible"] = sum(1 for case in cases if case["truly_eligible"])
    return summary


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.mocks.gen_datasets")
    parser.add_argument("--force", action="store_true", help="regenerate even if the files exist")
    args = parser.parse_args(list(argv) if argv is not None else None)
    print(json.dumps(generate(force=args.force), ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())


__all__ = [
    "AMBIGUOUS",
    "HARD_NEGATIVES",
    "LEGIT_FAMILIES",
    "SCAM_FAMILIES",
    "build_eval_cases",
    "build_scam_dataset",
    "generate",
    "main",
]
