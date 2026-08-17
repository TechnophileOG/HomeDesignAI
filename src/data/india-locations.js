/* ════════════════════════════════════════════════════════════════════════════
   KatalogitAI — India State & City data (onboarding)
   ────────────────────────────────────────────────────────────────────────────
   All 28 states + 8 union territories with their well-known cities, so the
   City field is chosen from a State → City cascade instead of free text.
   The data ships inside the bundle (no runtime API, works offline).

   Structure: [{ state: 'Maharashtra', cities: ['Mumbai', 'Pune', ...] }, ...]
   'Other' is appended at render time — a seller whose city is missing can
   still type it (still sanitized end-to-end).
   ════════════════════════════════════════════════════════════════════════════ */

export const INDIA_LOCATIONS = [
  {
    state: 'Andhra Pradesh',
    cities: ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Kurnool', 'Rajahmundry',
      'Tirupati', 'Kadapa', 'Anantapur', 'Eluru', 'Ongole', 'Srikakulam', 'Vizianagaram',
      'Machilipatnam', 'Chittoor', 'Tenali', 'Hindupur', 'Proddatur', 'Bhimavaram',
      'Tadepalligudem', 'Narasaraopet', 'Adoni', 'Nandyal', 'Guntakal', 'Amalapuram', 'Nuzvid'],
  },
  {
    state: 'Arunachal Pradesh',
    cities: ['Itanagar', 'Tawang', 'Pasighat', 'Ziro', 'Bomdila', 'Naharlagun', 'Tezu',
      'Aalo', 'Namsai', 'Roing', 'Seppa', 'Khonsa', 'Yingkiong', 'Changlang', 'Daporijo',
      'Anini', 'Longding'],
  },
  {
    state: 'Assam',
    cities: ['Guwahati', 'Silchar', 'Dibrugarh', 'Jorhat', 'Nagaon', 'Tezpur', 'Tinsukia',
      'Bongaigaon', 'Karimganj', 'Dhubri', 'North Lakhimpur', 'Golaghat', 'Sivasagar',
      'Diphu', 'Barpeta', 'Hailakandi', 'Kokrajhar', 'Goalpara', 'Mangaldoi', 'Nalbari',
      'Morigaon', 'Dhemaji'],
  },
  {
    state: 'Bihar',
    cities: ['Patna', 'Gaya', 'Bhagalpur', 'Muzaffarpur', 'Darbhanga', 'Purnia', 'Arrah',
      'Begusarai', 'Katihar', 'Munger', 'Chapra', 'Motihari', 'Bettiah', 'Saharsa',
      'Sasaram', 'Hajipur', 'Sitamarhi', 'Siwan', 'Samastipur', 'Madhubani', 'Buxar',
      'Aurangabad', 'Nawada', 'Jamalpur', 'Gopalganj', 'Kishanganj', 'Banka', 'Sheikhpura'],
  },
  {
    state: 'Chhattisgarh',
    cities: ['Raipur', 'Bhilai', 'Bilaspur', 'Korba', 'Durg', 'Jagdalpur', 'Raigarh',
      'Ambikapur', 'Rajnandgaon', 'Dhamtari', 'Mahasamund', 'Kanker', 'Janjgir', 'Champa',
      'Dalli-Rajhara', 'Bhatapara', 'Kawardha', 'Kondagaon'],
  },
  {
    state: 'Goa',
    cities: ['Panaji', 'Margao', 'Vasco da Gama', 'Mapusa', 'Ponda', 'Bicholim',
      'Curchorem', 'Canacona', 'Pernem', 'Sanquelim', 'Valpoi', 'Cuncolim', 'Quepem'],
  },
  {
    state: 'Gujarat',
    cities: ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar', 'Jamnagar', 'Junagadh',
      'Gandhinagar', 'Anand', 'Nadiad', 'Morbi', 'Surendranagar', 'Gandhidham', 'Bharuch',
      'Navsari', 'Valsad', 'Mehsana', 'Palanpur', 'Porbandar', 'Godhra', 'Patan', 'Amreli',
      'Veraval', 'Botad', 'Vapi', 'Ankleshwar', 'Dahod', 'Bhuj', 'Deesa'],
  },
  {
    state: 'Haryana',
    cities: ['Faridabad', 'Gurugram', 'Panipat', 'Ambala', 'Yamunanagar', 'Rohtak', 'Hisar',
      'Karnal', 'Sonipat', 'Panchkula', 'Kurukshetra', 'Bhiwani', 'Sirsa', 'Bahadurgarh',
      'Jind', 'Kaithal', 'Rewari', 'Palwal', 'Fatehabad', 'Narnaul', 'Charkhi Dadri',
      'Hansi', 'Thanesar'],
  },
  {
    state: 'Himachal Pradesh',
    cities: ['Shimla', 'Manali', 'Dharamshala', 'Solan', 'Mandi', 'Baddi', 'Kullu', 'Kangra',
      'Palampur', 'Una', 'Hamirpur', 'Bilaspur', 'Chamba', 'Nahan', 'Sundernagar',
      'Paonta Sahib'],
  },
  {
    state: 'Jharkhand',
    cities: ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro', 'Deoghar', 'Hazaribagh', 'Giridih',
      'Ramgarh', 'Medininagar', 'Chaibasa', 'Dumka', 'Phusro', 'Gumla', 'Simdega', 'Godda',
      'Sahibganj', 'Pakur', 'Latehar', 'Khunti', 'Koderma'],
  },
  {
    state: 'Karnataka',
    cities: ['Bengaluru', 'Mysuru', 'Hubballi', 'Mangaluru', 'Belagavi', 'Davanagere',
      'Ballari', 'Vijayapura', 'Kalaburagi', 'Shivamogga', 'Tumakuru', 'Raichur', 'Bidar',
      'Udupi', 'Hassan', 'Hospet', 'Gadag', 'Chitradurga', 'Kolar', 'Mandya',
      'Chikkamagaluru', 'Bagalkot', 'Karwar', 'Sirsi', 'Ramanagara', 'Bhadravati'],
  },
  {
    state: 'Kerala',
    cities: ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur', 'Kollam', 'Kannur',
      'Alappuzha', 'Palakkad', 'Kottayam', 'Malappuram', 'Kasaragod', 'Kalpetta', 'Idukki',
      'Pathanamthitta', 'Ponnani', 'Thalassery', 'Payyanur', 'Vatakara', 'Guruvayur',
      'Changanassery'],
  },
  {
    state: 'Madhya Pradesh',
    cities: ['Indore', 'Bhopal', 'Jabalpur', 'Gwalior', 'Ujjain', 'Sagar', 'Dewas', 'Satna',
      'Ratlam', 'Rewa', 'Katni', 'Singrauli', 'Burhanpur', 'Khandwa', 'Bhind', 'Guna',
      'Vidisha', 'Chhindwara', 'Morena', 'Betul', 'Narmadapuram', 'Mandsaur', 'Itarsi',
      'Damoh', 'Shivpuri', 'Sehore', 'Neemuch', 'Datia', 'Khargone'],
  },
  {
    state: 'Maharashtra',
    cities: ['Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Thane', 'Aurangabad', 'Solapur',
      'Amravati', 'Kolhapur', 'Nanded', 'Sangli', 'Jalgaon', 'Akola', 'Latur', 'Malegaon',
      'Dhule', 'Ahmednagar', 'Chandrapur', 'Parbhani', 'Ichalkaranji', 'Satara', 'Beed',
      'Wardha', 'Yavatmal', 'Bhiwandi', 'Panvel', 'Kalyan-Dombivli', 'Vasai-Virar',
      'Mira-Bhayandar', 'Ulhasnagar', 'Ambernath', 'Navi Mumbai', 'Karad', 'Osmanabad'],
  },
  {
    state: 'Manipur',
    cities: ['Imphal', 'Thoubal', 'Bishnupur', 'Churachandpur', 'Ukhrul', 'Kakching',
      'Senapati', 'Tamenglong', 'Chandel', 'Jiribam', 'Moirang', 'Wangjing'],
  },
  {
    state: 'Meghalaya',
    cities: ['Shillong', 'Tura', 'Jowai', 'Nongstoin', 'Williamnagar', 'Baghmara', 'Nongpoh',
      'Resubelpara', 'Mairang', 'Sohra', 'Mawlai'],
  },
  {
    state: 'Mizoram',
    cities: ['Aizawl', 'Lunglei', 'Champhai', 'Serchhip', 'Kolasib', 'Saiha', 'Lawngtlai',
      'Mamit', 'Saitual', 'Khawzawl', 'Hnahthial'],
  },
  {
    state: 'Nagaland',
    cities: ['Kohima', 'Dimapur', 'Mokokchung', 'Tuensang', 'Wokha', 'Zunheboto', 'Mon',
      'Phek', 'Kiphire', 'Longleng', 'Peren', 'Chumukedima', 'Niuland'],
  },
  {
    state: 'Odisha',
    cities: ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Sambalpur', 'Berhampur', 'Puri',
      'Balasore', 'Bhadrak', 'Baripada', 'Jeypore', 'Angul', 'Jharsuguda', 'Bargarh',
      'Balangir', 'Dhenkanal', 'Boudh', 'Nayagarh', 'Kendrapara', 'Jagatsinghpur',
      'Paradeep', 'Koraput', 'Rayagada', 'Sundargarh', 'Talcher', 'Barbil'],
  },
  {
    state: 'Punjab',
    cities: ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Bathinda', 'Mohali',
      'Hoshiarpur', 'Batala', 'Pathankot', 'Moga', 'Abohar', 'Khanna', 'Phagwara',
      'Firozpur', 'Kapurthala', 'Muktsar', 'Barnala', 'Rajpura', 'Malerkotla', 'Gurdaspur',
      'Fatehgarh Sahib', 'Tarn Taran', 'Nabha', 'Jagraon'],
  },
  {
    state: 'Rajasthan',
    cities: ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Bikaner', 'Ajmer', 'Bhilwara', 'Alwar',
      'Sikar', 'Bharatpur', 'Sri Ganganagar', 'Pali', 'Tonk', 'Kishangarh', 'Beawar',
      'Hanumangarh', 'Dhaulpur', 'Churu', 'Sawai Madhopur', 'Baran', 'Jhalawar', 'Nagaur',
      'Abu Road', 'Bundi', 'Karauli', 'Chittorgarh', 'Banswara', 'Gangapur City'],
  },
  {
    state: 'Sikkim',
    cities: ['Gangtok', 'Namchi', 'Gyalshing', 'Mangan', 'Rangpo', 'Jorethang', 'Singtam',
      'Rhenock', 'Rabong', 'Lachung', 'Chungthang'],
  },
  {
    state: 'Tamil Nadu',
    cities: ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli',
      'Vellore', 'Erode', 'Thoothukudi', 'Thanjavur', 'Dindigul', 'Kanchipuram', 'Karur',
      'Nagercoil', 'Hosur', 'Ooty', 'Kodaikanal', 'Cuddalore', 'Nagapattinam', 'Tiruppur',
      'Avadi', 'Tambaram', 'Kumbakonam', 'Rajapalayam', 'Sivakasi', 'Virudhunagar',
      'Pudukkottai', 'Sivaganga', 'Ramanathapuram', 'Krishnagiri', 'Dharmapuri', 'Namakkal',
      'Tiruvannamalai', 'Villupuram', 'Tenkasi'],
  },
  {
    state: 'Telangana',
    cities: ['Hyderabad', 'Warangal', 'Nizamabad', 'Karimnagar', 'Khammam', 'Ramagundam',
      'Mahbubnagar', 'Nalgonda', 'Adilabad', 'Siddipet', 'Miryalaguda', 'Suryapet', 'Jagtial',
      'Sangareddy', 'Kamareddy', 'Mancherial', 'Bhadrachalam', 'Bodhan', 'Kothagudem',
      'Peddapalli'],
  },
  {
    state: 'Tripura',
    cities: ['Agartala', 'Udaipur', 'Dharmanagar', 'Kailashahar', 'Belonia', 'Teliamura',
      'Sabroom', 'Amarpur', 'Khowai', 'Kamalpur', 'Sonamura', 'Melaghar'],
  },
  {
    state: 'Uttar Pradesh',
    cities: ['Lucknow', 'Kanpur', 'Ghaziabad', 'Agra', 'Varanasi', 'Meerut', 'Prayagraj',
      'Bareilly', 'Aligarh', 'Moradabad', 'Saharanpur', 'Gorakhpur', 'Noida', 'Greater Noida',
      'Firozabad', 'Jhansi', 'Muzaffarnagar', 'Mathura', 'Raebareli', 'Etawah', 'Mirzapur',
      'Shahjahanpur', 'Budaun', 'Farrukhabad', 'Amroha', 'Hapur', 'Modinagar', 'Unnao',
      'Jaunpur', 'Ghazipur', 'Ballia', 'Ayodhya', 'Rampur', 'Sitapur', 'Lakhimpur Kheri',
      'Mainpuri', 'Pilibhit', 'Sambhal', 'Basti', 'Banda', 'Lalitpur', 'Chandauli',
      'Kushinagar', 'Deoria', 'Azamgarh', 'Sultanpur', 'Hardoi', 'Etah', 'Kannauj', 'Gonda',
      'Bahraich', 'Barabanki', 'Robertsganj', 'Maharajganj', 'Bijnor', 'Hathras', 'Kasganj',
      'Fatehpur', 'Pratapgarh', 'Amethi'],
  },
  {
    state: 'Uttarakhand',
    cities: ['Dehradun', 'Haridwar', 'Roorkee', 'Haldwani', 'Rudrapur', 'Kashipur',
      'Rishikesh', 'Nainital', 'Mussoorie', 'Almora', 'Pithoragarh', 'Ramnagar', 'Kotdwar',
      'Bageshwar', 'Champawat', 'Srinagar', 'Vikasnagar', 'Sitarganj', 'Tanakpur'],
  },
  {
    state: 'West Bengal',
    cities: ['Kolkata', 'Howrah', 'Durgapur', 'Asansol', 'Siliguri', 'Bardhaman', 'Malda',
      'Kharagpur', 'Haldia', 'Krishnanagar', 'Darjeeling', 'Jalpaiguri', 'Berhampore',
      'Bankura', 'Purulia', 'Raiganj', 'Cooch Behar', 'English Bazar', 'Katwa', 'Balurghat',
      'Medinipur', 'Raghunathganj', 'Nabadwip', 'Barasat', 'Madhyamgram', 'Barrackpore',
      'Dum Dum', 'Kalyani', 'Serampore', 'Bally', 'Sonarpur', 'Baruipur', 'Contai', 'Tamluk',
      'Arambagh', 'Bishnupur', 'Suri', 'Bolpur', 'Rampurhat', 'Jangipur', 'Dinhata',
      'Jhargram', 'Uluberia', 'Baidyabati', 'Uttarpara'],
  },
  {
    state: 'Andaman & Nicobar Islands',
    cities: ['Port Blair', 'Bambooflat', 'Diglipur', 'Rangat', 'Mayabunder', 'Car Nicobar'],
  },
  {
    state: 'Chandigarh',
    cities: ['Chandigarh'],
  },
  {
    state: 'Dadra & Nagar Haveli and Daman & Diu',
    cities: ['Daman', 'Diu', 'Silvassa', 'Amli'],
  },
  {
    state: 'Delhi',
    cities: ['New Delhi', 'Dwarka', 'Rohini', 'Karol Bagh', 'Chandni Chowk', 'Connaught Place',
      'Lajpat Nagar', 'Saket', 'Vasant Kunj', 'Janakpuri', 'Hauz Khas', 'Paharganj',
      'Pitampura', 'Mayur Vihar', 'Sarita Vihar', 'Mehrauli', 'Najafgarh', 'Narela', 'Bawana'],
  },
  {
    state: 'Jammu & Kashmir',
    cities: ['Srinagar', 'Jammu', 'Anantnag', 'Baramulla', 'Udhampur', 'Kathua', 'Sopore',
      'Pulwama', 'Kupwara', 'Rajouri', 'Poonch', 'Doda', 'Kishtwar', 'Ramban', 'Samba',
      'Bandipora', 'Ganderbal', 'Kulgam', 'Shopian', 'Budgam', 'Bhaderwah', 'Banihal'],
  },
  {
    state: 'Ladakh',
    cities: ['Leh', 'Kargil', 'Dras', 'Padum', 'Diskit', 'Nyoma', 'Khaltsi', 'Sankoo'],
  },
  {
    state: 'Lakshadweep',
    cities: ['Kavaratti', 'Agatti', 'Amini', 'Andrott', 'Kalpeni', 'Minicoy', 'Kadmat',
      'Kiltan', 'Chetlat', 'Bangaram'],
  },
  {
    state: 'Puducherry',
    cities: ['Puducherry', 'Karaikal', 'Mahe', 'Yanam', 'Oulgaret', 'Villianur',
      'Ariyankuppam', 'Thirubuvanai'],
  },
];

/** Flat helper — the cities for a given state (or [] if unknown). */
export const citiesForState = (state) => {
  const hit = INDIA_LOCATIONS.find((l) => l.state === state);
  return hit ? hit.cities : [];
};
