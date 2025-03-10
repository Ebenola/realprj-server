const locations = {
    "Lagos": ["Ikeja", "Lekki", "Victoria Island", "Ajah", "Ibeju-Lekki",
        "Epe","Surulere", "Yaba", "Ketu", "Oke-Odo", "Agege", "Apapa", 
        "Iganmu", "Ipaja", "Badagry", "Egbe"],
    "Abuja": ["Garki", "Wuse", "Wuse 2", "Asokoro", "Maitama", "Gwarinpa",
        "Central Area Phase 2", "Central Business District", "Diplomatic Zones",
        "Cultural Zones", "Katampe", "Lugbe"],
    "Rivers": ["Port Harcourt", "Obio/Akpor", "Bonny"],
    "Ogun": ["Abeokuta", "Ijebu Ode", "Sango Ota"],
    "Kano": ["Kano City", "Dala", "Fagge"],
    "Oyo": ["Ibadan", "Ogbomosho", "Oyo"],
    "Enugu": ["Enugu", "Nsukka"],
    "Kaduna": ["Kaduna", "Zaria", "Kafanchan"],
    "Akwa Ibom": ["Uyo", "Nwaniba Road", "Oron Road", "Eket", "Ikot-Ekpene", "Oron"],
    "Cross-River": ["Calabar", "Ikom"],
    "Abia": ["Umuahia", "Aba"],
    // Expand as needed
};

module.exports = {
    states: Object.keys(locations),
    citiesByState: locations
};