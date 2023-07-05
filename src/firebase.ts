// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
    apiKey: "AIzaSyBoM51QVlfrCE9AlSFA6V62uU4Yl5uqtNA",
    authDomain: "msgchain.firebaseapp.com",
    projectId: "msgchain",
    storageBucket: "msgchain.appspot.com",
    messagingSenderId: "638406161821",
    appId: "1:638406161821:web:9c62d8beb657454b0aab74",
    measurementId: "G-DG68Z3CLYQ",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const fireDb = getFirestore(app);

export const COLLECTION_NAME = process.env.COLLECTION_NAME || "chains_dev";
