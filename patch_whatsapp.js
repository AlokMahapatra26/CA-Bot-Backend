const fs = require('fs');

const path = 'src/controllers/whatsapp.controller.ts';
let content = fs.readFileSync(path, 'utf8');

// Replacements
content = content.replace(
  `    await updateClient(updatedClient.id, { bot_status: 'REGISTERING_DOB' });
    await sendMessage(
      \`*(Step 2/5)*\\nWhat is your *Date of Birth*? Reply in *DD-MM-YYYY* format (e.g., 15-08-1995).\`
    );
  } else if (!updatedClient.email) {
    await updateClient(updatedClient.id, { bot_status: 'REGISTERING_EMAIL' });
    await sendMessage(
      \`*(Step 3/5)*\\nWhat is your *Email Address*? (e.g., name@gmail.com)\`
    );
  } else if (!updatedClient.pan_media_url) {
    await updateClient(updatedClient.id, { bot_status: 'REGISTERING_PAN' });
    await sendMessage(
      \`*(Step 4/5)*\\nNow I need your *PAN Card* for KYC verification.\\n\\n\` +
      \`Please upload a clear photo or PDF of your *PAN Card* 📎\`
    );
  } else if (!updatedClient.aadhaar_media_url) {
    await updateClient(updatedClient.id, { bot_status: 'REGISTERING_AADHAAR' });
    await sendMessage(
      \`*(Step 5/5)*\\nAlmost done! Please now upload your *Aadhaar Card* 📎\`
    );`,
  `    await updateClient(updatedClient.id, { bot_status: 'REGISTERING_DOB' });
    await sendMessage(
      \`*(Step 2/5)*\\nWhat is your *Date of Birth*? Reply in *DD-MM-YYYY* format (e.g., 15-08-1995).\\n\\n\` +
      \`💡 Type *back* anytime to return to the previous step.\`
    );
  } else if (!updatedClient.email) {
    await updateClient(updatedClient.id, { bot_status: 'REGISTERING_EMAIL' });
    await sendMessage(
      \`*(Step 3/5)*\\nWhat is your *Email Address*? (e.g., name@gmail.com)\\n\\n\` +
      \`💡 Type *back* anytime to return to the previous step.\`
    );
  } else if (!updatedClient.pan_media_url) {
    await updateClient(updatedClient.id, { bot_status: 'REGISTERING_PAN' });
    await sendMessage(
      \`*(Step 4/5)*\\nNow I need your *PAN Card* for KYC verification.\\n\\n\` +
      \`Please upload a clear photo or PDF of your *PAN Card* 📎\\n\\n\` +
      \`💡 Type *back* anytime to return to the previous step.\`
    );
  } else if (!updatedClient.aadhaar_media_url) {
    await updateClient(updatedClient.id, { bot_status: 'REGISTERING_AADHAAR' });
    await sendMessage(
      \`*(Step 5/5)*\\nAlmost done! Please now upload your *Aadhaar Card* 📎\\n\\n\` +
      \`💡 Type *back* anytime to return to the previous step.\`
    );`
);

content = content.replace(
  `        \`Nice to meet you, *\${formattedName}*! 😊\\n\\n\` +
        \`*(Step 1/5)*\\nPlease reply with your *10-digit mobile number* (e.g., 9876543210).\`
      );`,
  `        \`Nice to meet you, *\${formattedName}*! 😊\\n\\n\` +
        \`*(Step 1/5)*\\nPlease reply with your *10-digit mobile number* (e.g., 9876543210).\\n\\n\` +
        \`💡 Type *back* anytime to return to the previous step.\`
      );`
);

content = content.replace(
  `      } else {
        // They haven't selected option 1 yet, show the service menu.
        await sendMessage(
          \`Welcome back, *\${client.full_name}*! 👋\\n\\n\` +
          \`🛎️ *What service do you need today?*\\n\\n\` +
          \`Please reply with the number:\\n\` +
          \`*1* — 📊 ITR Filing (Income Tax Return) for FY \${fy}\\n\\n\` +
          \`_More services coming soon!_\`
        );
      }`,
  `      } else {
        // They haven't selected option 1 yet, show the service menu.
        await sendMessage(
          \`Welcome back, *\${client.full_name}*! 👋\\n\\n\` +
          \`🛎️ *What service do you need today?*\\n\\n\` +
          \`Please reply with the number:\\n\` +
          \`*1* — 📊 ITR Filing (Income Tax Return) for FY \${fy}\\n\\n\` +
          \`_More services coming soon!_\\n\\n\` +
          \`💡 Type *back* anytime to return to the previous step.\`
        );
      }`
);

content = content.replace(
  `    if (isApproved) {
      const { fy } = getFinancialAndAssessmentYear();
      await sendMessage(
        \`🎉 *Registration Complete, \${name}!* Your account is verified and ready. 👋\\n\\n\` +
        \`🛎️ *What service do you need today?*\\n\\n\` +
        \`Please reply with the number:\\n\` +
        \`*1* — 📊 ITR Filing (Income Tax Return) for FY \${fy}\\n\\n\` +
        \`_More services coming soon!_\`
      );
    } else {`,
  `    if (isApproved) {
      const { fy } = getFinancialAndAssessmentYear();
      await sendMessage(
        \`🎉 *Registration Complete, \${name}!* Your account is verified and ready. 👋\\n\\n\` +
        \`🛎️ *What service do you need today?*\\n\\n\` +
        \`Please reply with the number:\\n\` +
        \`*1* — 📊 ITR Filing (Income Tax Return) for FY \${fy}\\n\\n\` +
        \`_More services coming soon!_\\n\\n\` +
        \`💡 Type *back* anytime to return to the previous step.\`
      );
    } else {`
);

content = content.replace(
  `        await updateFiling(filing.id, { status: 'AWAITING_BANK_NAME' });
        await sendMessage(
          \`📊 *ITR Filing — FY \${fy} (AY \${ay})*\\n\\n\` +
          \`Great, *\${client.full_name}*! Let's get your Income Tax Return filed.\\n\\n\` +
          \`I'll need your *bank account details* for your tax refund.\\n\\n\` +
          \`*Step 1/4:* What is the *Name of your Bank*? (e.g., HDFC Bank, SBI, ICICI Bank)\`
        );
      } else {`,
  `        await updateFiling(filing.id, { status: 'AWAITING_BANK_NAME' });
        await sendMessage(
          \`📊 *ITR Filing — FY \${fy} (AY \${ay})*\\n\\n\` +
          \`Great, *\${client.full_name}*! Let's get your Income Tax Return filed.\\n\\n\` +
          \`I'll need your *bank account details* for your tax refund.\\n\\n\` +
          \`*Step 1/4:* What is the *Name of your Bank*? (e.g., HDFC Bank, SBI, ICICI Bank)\\n\\n\` +
          \`💡 Type *back* anytime to return to the previous step.\`
        );
      } else {`
);

content = content.replace(
  `      if (choice === '1' || choice.toLowerCase().includes('itr')) {
        await updateFiling(filing.id, { status: 'AWAITING_BANK_NAME' });
        await sendMessage(
          \`📊 *ITR Filing — FY \${fy} (AY \${ay})*\\n\\n\` +
          \`Great, *\${userName}*! Let's get your Income Tax Return filed.\\n\\n\` +
          \`I'll need your *bank account details* for your tax refund.\\n\\n\` +
          \`*Step 1/4:* What is the *Name of your Bank*? (e.g., HDFC Bank, SBI, ICICI Bank)\`
        );
      } else {`,
  `      if (choice === '1' || choice.toLowerCase().includes('itr')) {
        await updateFiling(filing.id, { status: 'AWAITING_BANK_NAME' });
        await sendMessage(
          \`📊 *ITR Filing — FY \${fy} (AY \${ay})*\\n\\n\` +
          \`Great, *\${userName}*! Let's get your Income Tax Return filed.\\n\\n\` +
          \`I'll need your *bank account details* for your tax refund.\\n\\n\` +
          \`*Step 1/4:* What is the *Name of your Bank*? (e.g., HDFC Bank, SBI, ICICI Bank)\\n\\n\` +
          \`💡 Type *back* anytime to return to the previous step.\`
        );
      } else {`
);

content = content.replace(
  `      } else {
        await sendMessage(
          \`Please reply with a valid option:\\n\\n\` +
          \`*1* — 📊 ITR Filing (Income Tax Return)\\n\\n\` +
          \`_More services coming soon!_\`
        );
      }`,
  `      } else {
        await sendMessage(
          \`Please reply with a valid option (type the number):\\n\\n\` +
          \`*1* — 📊 ITR Filing (Income Tax Return)\\n\\n\` +
          \`_More services coming soon!_\\n\\n\` +
          \`💡 Type *back* anytime to return to the previous step.\`
        );
      }`
);

content = content.replace(
  `      await updateFiling(filing.id, { bank_name: incomingMessage, status: 'AWAITING_BANK_ACC' });
      await sendMessage(\`✅ Bank: *\${incomingMessage}*\\n\\n*Step 2/4:* Please reply with your *Bank Account Number*.\`);
      break;`,
  `      await updateFiling(filing.id, { bank_name: incomingMessage, status: 'AWAITING_BANK_ACC' });
      await sendMessage(\`✅ Bank: *\${incomingMessage}*\\n\\n*Step 2/4:* Please reply with your *Bank Account Number*.\\n\\n💡 Type *back* anytime to return to the previous step.\`);
      break;`
);

content = content.replace(
  `      await updateFiling(filing.id, { bank_account_number: acc, status: 'AWAITING_BANK_IFSC' });
      await sendMessage(\`✅ Account number saved!\\n\\n*Step 3/4:* Please reply with your bank's *IFSC Code* (e.g., HDFC0001234).\`);
      break;`,
  `      await updateFiling(filing.id, { bank_account_number: acc, status: 'AWAITING_BANK_IFSC' });
      await sendMessage(\`✅ Account number saved!\\n\\n*Step 3/4:* Please reply with your bank's *IFSC Code* (e.g., HDFC0001234).\\n\\n💡 Type *back* anytime to return to the previous step.\`);
      break;`
);

content = content.replace(
  `      await updateFiling(filing.id, { bank_ifsc: ifsc, status: 'AWAITING_INCOME_SOURCE' });
      await sendMessage(
        \`✅ IFSC: *\${ifsc}*\\n\\n🏦 *Bank details saved!*\\n\\n\` +
        \`━━━━━━━━━━━━━━━━━━━━━\\n\\n\` +
        \`🛎️ *Please select your primary source of income:*\\n\\n\` +
        \`*1* — 👔 Salaried Employee\\n\` +
        \`*2* — 💼 Self-Employed / Business / Freelancer\\n\` +
        \`*3* — 📈 Investor / Trader (Stocks, Mutual Funds, Crypto)\\n\` +
        \`*4* — 🏠 Property Seller / Landlord (Real Estate transactions)\\n\\n\` +
        \`_Reply with a number (1-4)._\`
      );
      break;`,
  `      await updateFiling(filing.id, { bank_ifsc: ifsc, status: 'AWAITING_INCOME_SOURCE' });
      await sendMessage(
        \`✅ IFSC: *\${ifsc}*\\n\\n🏦 *Bank details saved!*\\n\\n\` +
        \`━━━━━━━━━━━━━━━━━━━━━\\n\\n\` +
        \`🛎️ *Please select your primary source of income:*\\n\\n\` +
        \`*1* — 👔 Salaried Employee\\n\` +
        \`*2* — 💼 Self-Employed / Business / Freelancer\\n\` +
        \`*3* — 📈 Investor / Trader (Stocks, Mutual Funds, Crypto)\\n\` +
        \`*4* — 🏠 Property Seller / Landlord (Real Estate transactions)\\n\\n\` +
        \`_Reply with a number (1-4) to select._\\n\\n\` +
        \`💡 Type *back* anytime to return to the previous step.\`
      );
      break;`
);

content = content.replace(
  `          \`👔 *Salaried Income Details*\\n\\n\` +
          \`Please upload your **Form 16** (issued by your employer) as a PDF or clear photo 📎\`
        );`,
  `          \`👔 *Salaried Income Details*\\n\\n\` +
          \`Please upload your **Form 16** (issued by your employer) as a PDF or clear photo 📎\\n\\n\` +
          \`💡 Type *back* anytime to return to the previous step.\`
        );`
);

content = content.replace(
  `          \`💼 *Business / Freelance Details*\\n\\n\` +
          \`Please upload your **Bank Statement** for FY \${fy} (PDF or photo) 📎\`
        );`,
  `          \`💼 *Business / Freelance Details*\\n\\n\` +
          \`Please upload your **Bank Statement** for FY \${fy} (PDF or photo) 📎\\n\\n\` +
          \`💡 Type *back* anytime to return to the previous step.\`
        );`
);

content = content.replace(
  `          \`📈 *Investment & Trading Details*\\n\\n\` +
          \`Please upload your broker's **Capital Gains Statement** or Tax Report (PDF or photo) 📎\`
        );`,
  `          \`📈 *Investment & Trading Details*\\n\\n\` +
          \`Please upload your broker's **Capital Gains Statement** or Tax Report (PDF or photo) 📎\\n\\n\` +
          \`💡 Type *back* anytime to return to the previous step.\`
        );`
);

content = content.replace(
  `          \`🏠 *Property Transaction Details*\\n\\n\` +
          \`Please upload your **Property Sale/Purchase Deeds** or registration documents (PDF or photo) 📎\`
        );`,
  `          \`🏠 *Property Transaction Details*\\n\\n\` +
          \`Please upload your **Property Sale/Purchase Deeds** or registration documents (PDF or photo) 📎\\n\\n\` +
          \`💡 Type *back* anytime to return to the previous step.\`
        );`
);

content = content.replace(
  `        await sendMessage(
          \`⚠️ Invalid selection. Please reply with a number between 1 and 4:\\n\\n\` +
          \`*1* — 👔 Salaried\\n\` +
          \`*2* — 💼 Self-Employed / Business\\n\` +
          \`*3* — 📈 Investor / Trader\\n\` +
          \`*4* — 🏠 Property transactions\`
        );`,
  `        await sendMessage(
          \`⚠️ Invalid selection. Please reply with a number between 1 and 4 to select:\\n\\n\` +
          \`*1* — 👔 Salaried\\n\` +
          \`*2* — 💼 Self-Employed / Business\\n\` +
          \`*3* — 📈 Investor / Trader\\n\` +
          \`*4* — 🏠 Property transactions\\n\\n\` +
          \`💡 Type *back* anytime to return to the previous step.\`
        );`
);

content = content.replace(
  `        await sendMessage(
          \`✅ *Form 16 received!*\\n\\n\` +
          \`Did you buy or sell any real estate property (house, plot, land) during this financial year?\\n\\n\` +
          \`*1* — 🏠 Yes\\n\` +
          \`*2* — ❌ No\`
        );
      } else {`,
  `        await sendMessage(
          \`✅ *Form 16 received!*\\n\\n\` +
          \`Did you buy or sell any real estate property (house, plot, land) during this financial year?\\n\\n\` +
          \`*1* — 🏠 Yes\\n\` +
          \`*2* — ❌ No\\n\\n\` +
          \`_Reply with a number (1-2) to select._\\n\\n\` +
          \`💡 Type *back* anytime to return to the previous step.\`
        );
      } else {`
);

content = content.replace(
  `        await sendMessage(
          \`✅ *Bank Statement received!*\\n\\n\` +
          \`Did you buy or sell any real estate property (house, plot, land) during this financial year?\\n\\n\` +
          \`*1* — 🏠 Yes\\n\` +
          \`*2* — ❌ No\`
        );
      } else {`,
  `        await sendMessage(
          \`✅ *Bank Statement received!*\\n\\n\` +
          \`Did you buy or sell any real estate property (house, plot, land) during this financial year?\\n\\n\` +
          \`*1* — 🏠 Yes\\n\` +
          \`*2* — ❌ No\\n\\n\` +
          \`_Reply with a number (1-2) to select._\\n\\n\` +
          \`💡 Type *back* anytime to return to the previous step.\`
        );
      } else {`
);

content = content.replace(
  `        await sendMessage(
          \`✅ *Capital Gains Statement received!*\\n\\n\` +
          \`Did you buy or sell any real estate property (house, plot, land) during this financial year?\\n\\n\` +
          \`*1* — 🏠 Yes\\n\` +
          \`*2* — ❌ No\`
        );
      } else {`,
  `        await sendMessage(
          \`✅ *Capital Gains Statement received!*\\n\\n\` +
          \`Did you buy or sell any real estate property (house, plot, land) during this financial year?\\n\\n\` +
          \`*1* — 🏠 Yes\\n\` +
          \`*2* — ❌ No\\n\\n\` +
          \`_Reply with a number (1-2) to select._\\n\\n\` +
          \`💡 Type *back* anytime to return to the previous step.\`
        );
      } else {`
);

content = content.replace(
  `        await sendMessage(
          \`✅ *Property documents received!*\\n\\n\` +
          \`Do you have any other supporting tax documents (like rent agreements, insurance premium receipts, or dividend statements) to share?\\n\\n\` +
          \`*1* — 📎 Yes, upload other documents\\n\` +
          \`*2* — ❌ No, I am done\`
        );
      } else {`,
  `        await sendMessage(
          \`✅ *Property documents received!*\\n\\n\` +
          \`Do you have any other supporting tax documents (like rent agreements, insurance premium receipts, or dividend statements) to share?\\n\\n\` +
          \`*1* — 📎 Yes, upload other documents\\n\` +
          \`*2* — ❌ No, I am done\\n\\n\` +
          \`_Reply with a number (1-2) to select._\\n\\n\` +
          \`💡 Type *back* anytime to return to the previous step.\`
        );
      } else {`
);

content = content.replace(
  `          \`🏠 *Property Transaction Details*\\n\\n\` +
          \`Please upload your **Property Sale/Purchase Deeds** or registration documents (PDF or photo) 📎\`
        );
      } else if (choice === '2') {
        await updateFiling(filing.id, { status: 'AWAITING_OTHER_DOCS_DECISION' });
        await sendMessage(
          \`Do you have any other supporting tax documents (like rent agreements, insurance premium receipts, or dividend statements) to share?\\n\\n\` +
          \`*1* — 📎 Yes, upload other documents\\n\` +
          \`*2* — ❌ No, I am done\`
        );
      } else {
        await sendMessage(
          \`⚠️ Invalid selection. Did you buy or sell any real estate property during this financial year?\\n\\n\` +
          \`*1* — 🏠 Yes\\n\` +
          \`*2* — ❌ No\`
        );
      }`,
  `          \`🏠 *Property Transaction Details*\\n\\n\` +
          \`Please upload your **Property Sale/Purchase Deeds** or registration documents (PDF or photo) 📎\\n\\n\` +
          \`💡 Type *back* anytime to return to the previous step.\`
        );
      } else if (choice === '2') {
        await updateFiling(filing.id, { status: 'AWAITING_OTHER_DOCS_DECISION' });
        await sendMessage(
          \`Do you have any other supporting tax documents (like rent agreements, insurance premium receipts, or dividend statements) to share?\\n\\n\` +
          \`*1* — 📎 Yes, upload other documents\\n\` +
          \`*2* — ❌ No, I am done\\n\\n\` +
          \`_Reply with a number (1-2) to select._\\n\\n\` +
          \`💡 Type *back* anytime to return to the previous step.\`
        );
      } else {
        await sendMessage(
          \`⚠️ Invalid selection. Did you buy or sell any real estate property during this financial year?\\n\\n\` +
          \`*1* — 🏠 Yes\\n\` +
          \`*2* — ❌ No\\n\\n\` +
          \`_Reply with a number (1-2) to select._\\n\\n\` +
          \`💡 Type *back* anytime to return to the previous step.\`
        );
      }`
);

content = content.replace(
  `        await sendMessage(
          \`📎 *Other Supporting Documents*\\n\\n\` +
          \`Please upload your other tax files (PDF or Photo). Once uploaded, you can send more or submit! 📎\`
        );
      } else if (choice === '2') {
        await updateFiling(filing.id, { status: 'COMPLETED' });
        await sendMessage(
          \`🎉 *All Documents Submitted!*\\n\\n\` +
          \`Dear *\${userName}*, your ITR filing request for *FY \${filing.fy_year}* has been successfully logged.\\n\\n\` +
          \`Our CA team will review your documents and get back to you shortly.\\n\\n\` +
          \`Thank you for choosing *\${COMPANY_NAME}*! 🙏\`
        );
      } else {
        await sendMessage(
          \`⚠️ Invalid selection. Do you have any other supporting tax documents to share?\\n\\n\` +
          \`*1* — 📎 Yes, upload other documents\\n\` +
          \`*2* — ❌ No, I am done\`
        );
      }`,
  `        await sendMessage(
          \`📎 *Other Supporting Documents*\\n\\n\` +
          \`Please upload your other tax files (PDF or Photo). Once uploaded, you can send more or submit! 📎\\n\\n\` +
          \`💡 Type *back* anytime to return to the previous step.\`
        );
      } else if (choice === '2') {
        await updateFiling(filing.id, { status: 'COMPLETED' });
        await sendMessage(
          \`🎉 *All Documents Submitted!*\\n\\n\` +
          \`Dear *\${userName}*, your ITR filing request for *FY \${filing.fy_year}* has been successfully logged.\\n\\n\` +
          \`Our CA team will review your documents and get back to you shortly.\\n\\n\` +
          \`Thank you for choosing *\${COMPANY_NAME}*! 🙏\`
        );
      } else {
        await sendMessage(
          \`⚠️ Invalid selection. Do you have any other supporting tax documents to share?\\n\\n\` +
          \`*1* — 📎 Yes, upload other documents\\n\` +
          \`*2* — ❌ No, I am done\\n\\n\` +
          \`_Reply with a number (1-2) to select._\\n\\n\` +
          \`💡 Type *back* anytime to return to the previous step.\`
        );
      }`
);

fs.writeFileSync(path, content, 'utf8');
console.log('Patched file successfully');
