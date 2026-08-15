const STORAGE_KEY = 'fs-language';
const supportedLanguages = new Set(['en', 'hi', 'ml']);

const translations = {
  hi: {
    'Skip to main content': 'मुख्य सामग्री पर जाएँ',
    'Commercial supply network': 'वाणिज्यिक आपूर्ति नेटवर्क',
    'Buy': 'खरीदें', 'Sell': 'बेचें', 'Fish': 'मछली', 'Spices': 'मसाले',
    'Managed Matching': 'प्रबंधित मिलान', 'Market Intelligence': 'बाज़ार जानकारी', 'Safety': 'सुरक्षा', 'About': 'हमारे बारे में', 'Contact': 'संपर्क',
    'Post Requirement': 'आवश्यकता पोस्ट करें', 'List Stock': 'स्टॉक सूचीबद्ध करें',
    'Open menu': 'मेनू खोलें', 'Close menu': 'मेनू बंद करें', 'Primary navigation': 'मुख्य नेविगेशन',
    'Independent commercial sourcing platform': 'स्वतंत्र वाणिज्यिक सोर्सिंग प्लेटफ़ॉर्म',
    'One trade network for fish and spices.': 'मछली और मसालों के लिए एक व्यापार नेटवर्क।',
    'Submit commercial buying requirements or list available stock for structured lead qualification and potential business matching.': 'संरचित लीड योग्यता और संभावित व्यावसायिक मिलान के लिए खरीद आवश्यकताएँ जमा करें या उपलब्ध स्टॉक सूचीबद्ध करें।',
    'I Want to Buy': 'मैं खरीदना चाहता/चाहती हूँ', 'I Want to Sell': 'मैं बेचना चाहता/चाहती हूँ', 'Explore Categories': 'श्रेणियाँ देखें',
    'Connecting food supply with commercial demand.': 'खाद्य आपूर्ति को वाणिज्यिक मांग से जोड़ना।',
    'Two clear routes': 'दो स्पष्ट रास्ते', 'Start from your side of the trade.': 'व्यापार में अपनी भूमिका से शुरू करें।',
    'For commercial buyers': 'वाणिज्यिक खरीदारों के लिए', 'For producers and suppliers': 'उत्पादकों और आपूर्तिकर्ताओं के लिए',
    'Source against a defined requirement.': 'स्पष्ट आवश्यकता के अनुसार स्रोत खोजें।', 'Present stock with commercial detail.': 'वाणिज्यिक विवरण के साथ स्टॉक प्रस्तुत करें।',
    'Post Buying Requirement': 'खरीद आवश्यकता पोस्ट करें', 'List Available Stock': 'उपलब्ध स्टॉक सूचीबद्ध करें',
    'Buy fish or seafood': 'मछली या समुद्री भोजन खरीदें', 'Sell spices': 'मसाले बेचें',
    'Commercial buyer intake': 'वाणिज्यिक खरीदार फ़ॉर्म', 'Submit a defined buying requirement.': 'स्पष्ट खरीद आवश्यकता जमा करें।',
    'Choose fish or spices first. We will ask only the category-specific questions needed to qualify a potential sourcing introduction.': 'पहले मछली या मसाले चुनें। संभावित सोर्सिंग परिचय के लिए केवल संबंधित श्रेणी के प्रश्न पूछे जाएँगे।',
    'Step 1 / Choose a category': 'चरण 1 / श्रेणी चुनें', 'What do you need to buy?': 'आप क्या खरीदना चाहते हैं?',
    'Buyer journey': 'खरीदार प्रक्रिया', 'Buy Fish or Seafood': 'मछली या समुद्री भोजन खरीदें', 'Buy Spices': 'मसाले खरीदें',
    'Private seller intake': 'निजी विक्रेता फ़ॉर्म', 'Present available stock with evidence.': 'प्रमाण सहित उपलब्ध स्टॉक प्रस्तुत करें।',
    'What do you want to sell?': 'आप क्या बेचना चाहते हैं?', 'Seller journey': 'विक्रेता प्रक्रिया', 'Sell Fish or Seafood': 'मछली या समुद्री भोजन बेचें', 'Sell Spices': 'मसाले बेचें',
    'Choose category': 'श्रेणी चुनें', 'Add requirement': 'आवश्यकता जोड़ें', 'Add availability': 'उपलब्धता जोड़ें', 'Review and send': 'समीक्षा करके भेजें',
    'Review requirement': 'आवश्यकता की समीक्षा करें', 'Review availability': 'उपलब्धता की समीक्षा करें',
    'Review and submit securely': 'समीक्षा करें और सुरक्षित रूप से जमा करें', 'Edit details': 'विवरण संपादित करें',
    'Submit requirement': 'आवश्यकता जमा करें', 'Submit availability': 'उपलब्धता जमा करें', 'Follow up on WhatsApp': 'WhatsApp पर संपर्क करें',
    'Buyer and company': 'खरीदार और कंपनी', 'Seller and organisation': 'विक्रेता और संगठन', 'Commercial requirement': 'वाणिज्यिक आवश्यकता', 'Commercial availability': 'वाणिज्यिक उपलब्धता',
    'Fish or seafood specification': 'मछली या समुद्री भोजन विनिर्देश', 'Spice specification': 'मसाला विनिर्देश', 'Fish or seafood availability': 'मछली या समुद्री भोजन उपलब्धता', 'Spice availability': 'मसाला उपलब्धता', 'Declarations': 'घोषणाएँ',
    'Full name': 'पूरा नाम', 'Job title': 'पद', 'Company name': 'कंपनी का नाम', 'Buyer type': 'खरीदार का प्रकार', 'Seller type': 'विक्रेता का प्रकार',
    'Business email': 'व्यावसायिक ईमेल', 'Email': 'ईमेल', 'WhatsApp or telephone': 'WhatsApp या फ़ोन', 'Company website': 'कंपनी वेबसाइट', 'Website or social profile': 'वेबसाइट या सोशल प्रोफ़ाइल',
    'Country': 'देश', 'State': 'राज्य', 'District': 'ज़िला', 'City': 'शहर', 'Locality': 'स्थान', 'Product category': 'उत्पाद श्रेणी', 'Commercial purpose': 'वाणिज्यिक उद्देश्य',
    'Purchase frequency': 'खरीद आवृत्ति', 'Destination country': 'गंतव्य देश', 'Delivery city or port': 'डिलीवरी शहर या बंदरगाह', 'Required date': 'आवश्यक तिथि',
    'Preferred Incoterm': 'पसंदीदा Incoterm', 'Sample requirement': 'नमूना आवश्यकता', 'Inspection requirement': 'निरीक्षण आवश्यकता', 'Additional notes': 'अतिरिक्त टिप्पणियाँ',
    'Common product name': 'सामान्य उत्पाद नाम', 'Product or common name': 'उत्पाद या सामान्य नाम', 'Scientific name': 'वैज्ञानिक नाम', 'Product form': 'उत्पाद रूप', 'Available form': 'उपलब्ध रूप',
    'Spice': 'मसाला', 'Variety': 'किस्म', 'Grade': 'ग्रेड', 'Origin preference': 'मूल स्थान प्राथमिकता', 'Required quantity': 'आवश्यक मात्रा', 'Current quantity': 'वर्तमान मात्रा', 'Quantity unit': 'मात्रा इकाई',
    'Packing requirement': 'पैकिंग आवश्यकता', 'Packing size': 'पैकिंग आकार', 'Packing material': 'पैकिंग सामग्री', 'Packing capability': 'पैकिंग क्षमता', 'Storage capability': 'भंडारण क्षमता',
    'Current availability date': 'वर्तमान उपलब्धता तिथि', 'Available date': 'उपलब्ध तिथि', 'Minimum order in the selected quantity unit': 'चुनी गई इकाई में न्यूनतम ऑर्डर', 'Delivery capability': 'डिलीवरी क्षमता',
    'Payment-term expectation': 'भुगतान शर्त अपेक्षा', 'Export capability': 'निर्यात क्षमता', 'Certifications': 'प्रमाणपत्र', 'Select an option': 'एक विकल्प चुनें',
    'Yes': 'हाँ', 'No': 'नहीं', 'Not sure': 'निश्चित नहीं', 'Other': 'अन्य', 'Optional': 'वैकल्पिक',
    'This information is required.': 'यह जानकारी आवश्यक है।', 'Enter a valid value.': 'मान्य जानकारी दर्ज करें।', 'Review the required information': 'आवश्यक जानकारी की समीक्षा करें',
    'Loading human verification...': 'मानव सत्यापन लोड हो रहा है...', 'Complete human verification to submit.': 'जमा करने के लिए मानव सत्यापन पूरा करें।',
    'Human verification complete. You can submit securely.': 'मानव सत्यापन पूरा हुआ। अब आप सुरक्षित रूप से जमा कर सकते हैं।', 'Saving your enquiry securely...': 'आपकी पूछताछ सुरक्षित रूप से सहेजी जा रही है...',
    'Not submitted': 'जमा नहीं किया गया', 'Pending': 'लंबित', 'New': 'नया', 'Not reviewed': 'समीक्षा नहीं हुई', 'Confirmed': 'पुष्टि की गई',
    'Language': 'भाषा', 'English': 'English', 'Hindi': 'हिन्दी', 'Malayalam': 'മലയാളം'
  },
  ml: {
    'Skip to main content': 'പ്രധാന ഉള്ളടക്കത്തിലേക്ക് പോകുക',
    'Commercial supply network': 'വാണിജ്യ വിതരണ ശൃംഖല',
    'Buy': 'വാങ്ങുക', 'Sell': 'വിൽക്കുക', 'Fish': 'മത്സ്യം', 'Spices': 'സുഗന്ധവ്യഞ്ജനങ്ങൾ',
    'Managed Matching': 'നിയന്ത്രിത പൊരുത്തപ്പെടുത്തൽ', 'Market Intelligence': 'വിപണി വിവരങ്ങൾ', 'Safety': 'സുരക്ഷ', 'About': 'ഞങ്ങളെക്കുറിച്ച്', 'Contact': 'ബന്ധപ്പെടുക',
    'Post Requirement': 'ആവശ്യം സമർപ്പിക്കുക', 'List Stock': 'സ്റ്റോക്ക് ചേർക്കുക',
    'Open menu': 'മെനു തുറക്കുക', 'Close menu': 'മെനു അടയ്ക്കുക', 'Primary navigation': 'പ്രധാന നാവിഗേഷൻ',
    'Independent commercial sourcing platform': 'സ്വതന്ത്ര വാണിജ്യ സോഴ്‌സിംഗ് പ്ലാറ്റ്‌ഫോം',
    'One trade network for fish and spices.': 'മത്സ്യത്തിനും സുഗന്ധവ്യഞ്ജനങ്ങൾക്കും ഒരു വ്യാപാര ശൃംഖല.',
    'Submit commercial buying requirements or list available stock for structured lead qualification and potential business matching.': 'ക്രമബദ്ധമായ ലീഡ് യോഗ്യതയ്ക്കും സാധ്യതയുള്ള ബിസിനസ് പൊരുത്തപ്പെടുത്തലിനുമായി വാങ്ങൽ ആവശ്യങ്ങൾ സമർപ്പിക്കുകയോ ലഭ്യമായ സ്റ്റോക്ക് ചേർക്കുകയോ ചെയ്യുക.',
    'I Want to Buy': 'എനിക്ക് വാങ്ങണം', 'I Want to Sell': 'എനിക്ക് വിൽക്കണം', 'Explore Categories': 'വിഭാഗങ്ങൾ കാണുക',
    'Connecting food supply with commercial demand.': 'ഭക്ഷ്യ വിതരണത്തെ വാണിജ്യ ആവശ്യവുമായി ബന്ധിപ്പിക്കുന്നു.',
    'Two clear routes': 'രണ്ട് വ്യക്തമായ വഴികൾ', 'Start from your side of the trade.': 'വ്യാപാരത്തിലെ നിങ്ങളുടെ ഭാഗത്ത് നിന്ന് ആരംഭിക്കുക.',
    'For commercial buyers': 'വാണിജ്യ വാങ്ങുന്നവർക്കായി', 'For producers and suppliers': 'ഉത്പാദകർക്കും വിതരണക്കാർക്കും',
    'Source against a defined requirement.': 'വ്യക്തമായ ആവശ്യത്തിനനുസരിച്ച് ഉറവിടം കണ്ടെത്തുക.', 'Present stock with commercial detail.': 'വാണിജ്യ വിവരങ്ങളോടെ സ്റ്റോക്ക് അവതരിപ്പിക്കുക.',
    'Post Buying Requirement': 'വാങ്ങൽ ആവശ്യം സമർപ്പിക്കുക', 'List Available Stock': 'ലഭ്യമായ സ്റ്റോക്ക് ചേർക്കുക',
    'Buy fish or seafood': 'മത്സ്യം അല്ലെങ്കിൽ കടൽവിഭവം വാങ്ങുക', 'Sell spices': 'സുഗന്ധവ്യഞ്ജനങ്ങൾ വിൽക്കുക',
    'Commercial buyer intake': 'വാണിജ്യ വാങ്ങുന്നവരുടെ ഫോം', 'Submit a defined buying requirement.': 'വ്യക്തമായ വാങ്ങൽ ആവശ്യം സമർപ്പിക്കുക.',
    'Choose fish or spices first. We will ask only the category-specific questions needed to qualify a potential sourcing introduction.': 'ആദ്യം മത്സ്യമോ സുഗന്ധവ്യഞ്ജനങ്ങളോ തിരഞ്ഞെടുക്കുക. സാധ്യതയുള്ള സോഴ്‌സിംഗ് പരിചയപ്പെടുത്തലിന് ആവശ്യമായ വിഭാഗ-നിർദ്ദിഷ്ട ചോദ്യങ്ങൾ മാത്രം ചോദിക്കും.',
    'Step 1 / Choose a category': 'ഘട്ടം 1 / വിഭാഗം തിരഞ്ഞെടുക്കുക', 'What do you need to buy?': 'നിങ്ങൾക്ക് എന്താണ് വാങ്ങേണ്ടത്?',
    'Buyer journey': 'വാങ്ങുന്നവരുടെ നടപടിക്രമം', 'Buy Fish or Seafood': 'മത്സ്യം അല്ലെങ്കിൽ കടൽവിഭവം വാങ്ങുക', 'Buy Spices': 'സുഗന്ധവ്യഞ്ജനങ്ങൾ വാങ്ങുക',
    'Private seller intake': 'സ്വകാര്യ വിൽപ്പനക്കാരുടെ ഫോം', 'Present available stock with evidence.': 'തെളിവുകളോടെ ലഭ്യമായ സ്റ്റോക്ക് അവതരിപ്പിക്കുക.',
    'What do you want to sell?': 'നിങ്ങൾക്ക് എന്താണ് വിൽക്കേണ്ടത്?', 'Seller journey': 'വിൽപ്പനക്കാരുടെ നടപടിക്രമം', 'Sell Fish or Seafood': 'മത്സ്യം അല്ലെങ്കിൽ കടൽവിഭവം വിൽക്കുക', 'Sell Spices': 'സുഗന്ധവ്യഞ്ജനങ്ങൾ വിൽക്കുക',
    'Choose category': 'വിഭാഗം തിരഞ്ഞെടുക്കുക', 'Add requirement': 'ആവശ്യം ചേർക്കുക', 'Add availability': 'ലഭ്യത ചേർക്കുക', 'Review and send': 'പരിശോധിച്ച് അയയ്ക്കുക',
    'Review requirement': 'ആവശ്യം പരിശോധിക്കുക', 'Review availability': 'ലഭ്യത പരിശോധിക്കുക',
    'Review and submit securely': 'പരിശോധിച്ച് സുരക്ഷിതമായി സമർപ്പിക്കുക', 'Edit details': 'വിവരങ്ങൾ തിരുത്തുക',
    'Submit requirement': 'ആവശ്യം സമർപ്പിക്കുക', 'Submit availability': 'ലഭ്യത സമർപ്പിക്കുക', 'Follow up on WhatsApp': 'WhatsApp-ൽ ബന്ധപ്പെടുക',
    'Buyer and company': 'വാങ്ങുന്നവരും കമ്പനിയും', 'Seller and organisation': 'വിൽപ്പനക്കാരനും സ്ഥാപനവും', 'Commercial requirement': 'വാണിജ്യ ആവശ്യം', 'Commercial availability': 'വാണിജ്യ ലഭ്യത',
    'Fish or seafood specification': 'മത്സ്യം അല്ലെങ്കിൽ കടൽവിഭവ സവിശേഷത', 'Spice specification': 'സുഗന്ധവ്യഞ്ജന സവിശേഷത', 'Fish or seafood availability': 'മത്സ്യം അല്ലെങ്കിൽ കടൽവിഭവ ലഭ്യത', 'Spice availability': 'സുഗന്ധവ്യഞ്ജന ലഭ്യത', 'Declarations': 'പ്രഖ്യാപനങ്ങൾ',
    'Full name': 'പൂർണ്ണ പേര്', 'Job title': 'പദവി', 'Company name': 'കമ്പനിയുടെ പേര്', 'Buyer type': 'വാങ്ങുന്നവരുടെ തരം', 'Seller type': 'വിൽപ്പനക്കാരുടെ തരം',
    'Business email': 'ബിസിനസ് ഇമെയിൽ', 'Email': 'ഇമെയിൽ', 'WhatsApp or telephone': 'WhatsApp അല്ലെങ്കിൽ ഫോൺ', 'Company website': 'കമ്പനി വെബ്‌സൈറ്റ്', 'Website or social profile': 'വെബ്‌സൈറ്റ് അല്ലെങ്കിൽ സോഷ്യൽ പ്രൊഫൈൽ',
    'Country': 'രാജ്യം', 'State': 'സംസ്ഥാനം', 'District': 'ജില്ല', 'City': 'നഗരം', 'Locality': 'സ്ഥലം', 'Product category': 'ഉൽപ്പന്ന വിഭാഗം', 'Commercial purpose': 'വാണിജ്യ ഉദ്ദേശ്യം',
    'Purchase frequency': 'വാങ്ങൽ ആവൃത്തി', 'Destination country': 'ലക്ഷ്യ രാജ്യം', 'Delivery city or port': 'ഡെലിവറി നഗരം അല്ലെങ്കിൽ തുറമുഖം', 'Required date': 'ആവശ്യമായ തീയതി',
    'Preferred Incoterm': 'ഇഷ്ടപ്പെട്ട Incoterm', 'Sample requirement': 'സാമ്പിൾ ആവശ്യം', 'Inspection requirement': 'പരിശോധന ആവശ്യം', 'Additional notes': 'കൂടുതൽ കുറിപ്പുകൾ',
    'Common product name': 'പൊതുവായ ഉൽപ്പന്ന നാമം', 'Product or common name': 'ഉൽപ്പന്നം അല്ലെങ്കിൽ പൊതുനാമം', 'Scientific name': 'ശാസ്ത്രീയ നാമം', 'Product form': 'ഉൽപ്പന്ന രൂപം', 'Available form': 'ലഭ്യമായ രൂപം',
    'Spice': 'സുഗന്ധവ്യഞ്ജനം', 'Variety': 'ഇനം', 'Grade': 'ഗ്രേഡ്', 'Origin preference': 'ഉത്ഭവ മുൻഗണന', 'Required quantity': 'ആവശ്യമായ അളവ്', 'Current quantity': 'നിലവിലെ അളവ്', 'Quantity unit': 'അളവ് യൂണിറ്റ്',
    'Packing requirement': 'പാക്കിംഗ് ആവശ്യം', 'Packing size': 'പാക്കിംഗ് വലുപ്പം', 'Packing material': 'പാക്കിംഗ് വസ്തു', 'Packing capability': 'പാക്കിംഗ് ശേഷി', 'Storage capability': 'സംഭരണ ശേഷി',
    'Current availability date': 'നിലവിലെ ലഭ്യത തീയതി', 'Available date': 'ലഭ്യമായ തീയതി', 'Minimum order in the selected quantity unit': 'തിരഞ്ഞെടുത്ത യൂണിറ്റിലെ കുറഞ്ഞ ഓർഡർ', 'Delivery capability': 'ഡെലിവറി ശേഷി',
    'Payment-term expectation': 'പേയ്മെന്റ് വ്യവസ്ഥ പ്രതീക്ഷ', 'Export capability': 'കയറ്റുമതി ശേഷി', 'Certifications': 'സർട്ടിഫിക്കേഷനുകൾ', 'Select an option': 'ഒരു ഓപ്ഷൻ തിരഞ്ഞെടുക്കുക',
    'Yes': 'അതെ', 'No': 'അല്ല', 'Not sure': 'ഉറപ്പില്ല', 'Other': 'മറ്റുള്ളവ', 'Optional': 'ഐച്ഛികം',
    'This information is required.': 'ഈ വിവരം ആവശ്യമാണ്.', 'Enter a valid value.': 'സാധുവായ വിവരം നൽകുക.', 'Review the required information': 'ആവശ്യമായ വിവരങ്ങൾ പരിശോധിക്കുക',
    'Loading human verification...': 'മനുഷ്യ പരിശോധന ലോഡ് ചെയ്യുന്നു...', 'Complete human verification to submit.': 'സമർപ്പിക്കാൻ മനുഷ്യ പരിശോധന പൂർത്തിയാക്കുക.',
    'Human verification complete. You can submit securely.': 'മനുഷ്യ പരിശോധന പൂർത്തിയായി. ഇപ്പോൾ സുരക്ഷിതമായി സമർപ്പിക്കാം.', 'Saving your enquiry securely...': 'നിങ്ങളുടെ അന്വേഷണം സുരക്ഷിതമായി സൂക്ഷിക്കുന്നു...',
    'Not submitted': 'സമർപ്പിച്ചിട്ടില്ല', 'Pending': 'തീർപ്പാകാത്തത്', 'New': 'പുതിയത്', 'Not reviewed': 'പരിശോധിച്ചിട്ടില്ല', 'Confirmed': 'സ്ഥിരീകരിച്ചു',
    'Language': 'ഭാഷ', 'English': 'English', 'Hindi': 'हिन्दी', 'Malayalam': 'മലയാളം'
  }
};

const originalText = new WeakMap();
const originalAttributes = new WeakMap();
let currentLanguage = 'en';
let observer;

function translated(value, language = currentLanguage) {
  return language === 'en' ? value : translations[language]?.[value] || value;
}

function translateTextNode(node) {
  if (node.parentElement?.closest('.brand, .brand-footer, [data-no-translate]')) return;
  if (!originalText.has(node)) originalText.set(node, node.nodeValue);
  const original = originalText.get(node);
  const trimmed = original.trim();
  if (!trimmed) return;
  const replacement = translated(trimmed);
  node.nodeValue = original.replace(trimmed, replacement);
}

function translateAttributes(element) {
  for (const attribute of ['aria-label', 'placeholder', 'title']) {
    if (!element.hasAttribute(attribute)) continue;
    let values = originalAttributes.get(element);
    if (!values) { values = {}; originalAttributes.set(element, values); }
    if (!(attribute in values)) values[attribute] = element.getAttribute(attribute);
    element.setAttribute(attribute, translated(values[attribute]));
  }
}

function translateTree(root = document.body) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) translateTextNode(root);
  if (root.nodeType === Node.ELEMENT_NODE) translateAttributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) translateTextNode(node);
    else translateAttributes(node);
  }
}

function setLanguage(language) {
  currentLanguage = supportedLanguages.has(language) ? language : 'en';
  localStorage.setItem(STORAGE_KEY, currentLanguage);
  document.documentElement.lang = currentLanguage;
  observer?.disconnect();
  translateTree();
  document.querySelector('[data-language-select]')?.setAttribute('value', currentLanguage);
  const select = document.querySelector('[data-language-select]');
  if (select) select.value = currentLanguage;
  observer?.observe(document.body, { childList: true, subtree: true });
  document.dispatchEvent(new CustomEvent('fs:languagechange', { detail: { language: currentLanguage } }));
}

function createSelector() {
  const wrapper = document.createElement('div');
  wrapper.className = 'language-control';
  wrapper.innerHTML = `<label class="sr-only" for="site-language">Language</label><span aria-hidden="true">文</span><select id="site-language" data-language-select aria-label="Language"><option value="en">English</option><option value="hi">हिन्दी</option><option value="ml">മലയാളം</option></select>`;
  const headerInner = document.querySelector('.header-inner');
  if (headerInner) headerInner.insertBefore(wrapper, document.querySelector('.header-actions'));
  else { wrapper.classList.add('language-control-floating'); document.body.prepend(wrapper); }
  wrapper.querySelector('select').addEventListener('change', event => setLanguage(event.target.value));
}

currentLanguage = supportedLanguages.has(localStorage.getItem(STORAGE_KEY)) ? localStorage.getItem(STORAGE_KEY) : 'en';
createSelector();
observer = new MutationObserver(records => records.forEach(record => record.addedNodes.forEach(node => translateTree(node))));
setLanguage(currentLanguage);

window.FS_I18N = Object.freeze({
  get language() { return currentLanguage; },
  setLanguage,
  translate: translateTree,
  text: translated
});
