import { useState, useEffect, useRef } from 'react';
import { Upload, Loader2, CheckCircle, AlertCircle, X, Trash2, UserPlus } from 'lucide-react';

import { GoogleGenerativeAI } from '@google/generative-ai';

interface CardData {
  name: string;
  company: string;
  job_title: string;
  email: string;
  phone: string;
  website: string;
  address: string;
  social_links: string[];
}

interface ProcessedCard {
  id: string;
  previewUrl: string;
  data: CardData;
  timestamp: string;
}

interface User {
  userId: string;
  email: string;
  name: string;
  picture: string;
}

// Initialize Gemini AI
const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GOOGLE_API_KEY || '');

function App() {
  const [isProcessing, setIsProcessing] = useState(false);
  const [processedCards, setProcessedCards] = useState<ProcessedCard[]>([]);
  const [error, setError] = useState<string>('');
  const [success, setSuccess] = useState<string>('');
  const [processingProgress, setProcessingProgress] = useState<{ current: number, total: number } | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [showSignInModal, setShowSignInModal] = useState(false);
  const [listedCards, setListedCards] = useState<any[]>([]);
  const [isListing, setIsListing] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const authPopupRef = useRef<Window | null>(null);

  // Check if user is authenticated on component mount
  useEffect(() => {
    checkAuth();

    // Listen for auth success message from OAuth popup
    const handleMessage = (event: MessageEvent) => {
      if (event.data === 'auth_success') {
        setIsSigningIn(false);
        authPopupRef.current = null;
        checkAuth();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Local dev uses local API server; production uses same-origin.
  const API_BASE_URL = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)
    ? 'http://localhost:3001'
    : '';
  const apiUrl = (path: string) => `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;

  const checkAuth = async (): Promise<boolean> => {
    try {
      const response = await fetch(apiUrl('/api/user'), {
        credentials: 'include'
      });

      if (response.ok) {
        const userData = await response.json();
        setUser(userData);
        setShowSignInModal(false);
        return true;
      } else {
        setShowSignInModal(false);
        return false;
      }
    } catch (err) {
      console.error('Error checking auth:', err);
      setShowSignInModal(false);
      return false;
    }
  };

  const handleGoogleSignIn = async () => {
    if (isSigningIn) return;
    if (user) return;

    if (authPopupRef.current && !authPopupRef.current.closed) {
      authPopupRef.current.focus();
      return;
    }

    const alreadySignedIn = await checkAuth();
    if (alreadySignedIn) return;

    setIsSigningIn(true);
    const width = 600;
    const height = 700;
    const left = (window.innerWidth - width) / 2;
    const top = (window.innerHeight - height) / 2;

    const popup = window.open(
      apiUrl('/api/auth/google'),
      'google-auth',
      `width=${width},height=${height},left=${left},top=${top}`
    );
    authPopupRef.current = popup;

    if (!popup) {
      setIsSigningIn(false);
      setError('Popup blocked. Please allow popups and try again.');
      return;
    }

    // Avoid polling popup.closed across origins (COOP warning spam in console).
    // OAuth callback posts `auth_success` to the opener; that path now clears signing state.
    setTimeout(() => {
      setIsSigningIn(false);
      authPopupRef.current = null;
    }, 120000);
  };

  const processImage = async (file: File): Promise<{ previewUrl: string; data: CardData }> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const previewUrl = reader.result as string;
        const base64String = previewUrl.split(',')[1];

        try {
          const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

          const prompt = `You are an expert OCR and data extraction assistant.
Extract all relevant information from this business card image and return as JSON with keys:
{
  "name": "",
  "company": "",
  "job_title": "",
  "email": "",
  "phone": "",
  "website": "",
  "address": "",
  "social_links": []
}
If a field is missing, leave it blank.`;

          const result = await model.generateContent([
            {
              inlineData: {
                data: base64String,
                mimeType: file.type,
              },
            },
            prompt,
          ]);

          const response = await result.response;
          const text = response.text();

          let jsonString = text;
          const codeBlockMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
          if (codeBlockMatch) {
            jsonString = codeBlockMatch[1];
          }
          const jsonMatch = jsonString.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const cardData = JSON.parse(jsonMatch[0]);
            resolve({ previewUrl, data: cardData });
          } else {
            throw new Error('Failed to extract valid JSON from response');
          }
        } catch (err) {
          reject(err);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!user) {
      setError('Please sign in to upload and process images');
      setShowSignInModal(true);
      if (event.target) event.target.value = '';
      return;
    }

    const files = event.target.files;
    if (!files || files.length === 0) return;

    const validFiles = Array.from(files).filter(file => file.type.startsWith('image/'));

    if (validFiles.length === 0) {
      setError('Please upload valid image files');
      return;
    }

    setError('');
    setSuccess('');
    setIsProcessing(true);
    setProcessingProgress({ current: 0, total: validFiles.length });

    const newProcessedCards: ProcessedCard[] = [];

    for (let i = 0; i < validFiles.length; i++) {
      try {
        setProcessingProgress({ current: i + 1, total: validFiles.length });
        const result = await processImage(validFiles[i]);

        const card: ProcessedCard = {
          id: `${Date.now()}-${i}`,
          previewUrl: result.previewUrl,
          data: result.data,
          timestamp: new Date().toISOString(),
        };

        newProcessedCards.push(card);
      } catch (err) {
        console.error(`Failed to process image ${i + 1}:`, err);
      }
    }

    setProcessedCards(prev => [...newProcessedCards, ...prev]);

    const sessionData = JSON.parse(localStorage.getItem('cardSessions') || '[]');
    sessionData.push(...newProcessedCards);
    localStorage.setItem('cardSessions', JSON.stringify(sessionData));

    setIsProcessing(false);
    setProcessingProgress(null);
    event.target.value = '';
  };

  const handleRemoveCard = (id: string) => {
    setProcessedCards(prev => prev.filter(card => card.id !== id));

    const sessionData = JSON.parse(localStorage.getItem('cardSessions') || '[]');
    const updatedData = sessionData.filter((card: ProcessedCard) => card.id !== id);
    localStorage.setItem('cardSessions', JSON.stringify(updatedData));
  };

  const handleExportToSheets = async () => {
    if (processedCards.length === 0) return;

    if (!user) {
      setError('Please sign in to save to Google Sheets');
      setShowSignInModal(true);
      return;
    }

    setError('');
    setSuccess('');
    setIsProcessing(true);

    try {
      const saveToSheetsUrl = apiUrl('/api/save-to-sheets');
      const cardsForSheet = processedCards.map((card) => ({
        id: card.id,
        data: card.data,
        timestamp: card.timestamp,
      }));

      const response = await fetch(saveToSheetsUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          cards: cardsForSheet,
          email: user.email // Use email instead of id
        }),
      });

      let result;
      try {
        result = await response.clone().json();
      } catch (parseError) {
        console.error('Error parsing response:', parseError);
        const text = await response.text();
        console.error('Response text:', text);
        throw new Error('Invalid response from server');
      }

      if (!response.ok) {
        throw new Error(result?.error || `Failed to save to Google Sheets: ${response.statusText}`);
      }

      if (!result) {
        throw new Error('No response received from server');
      }

      setSuccess(result.message || `Successfully saved ${processedCards.length} card${processedCards.length > 1 ? 's' : ''} to Google Sheets`);

      if (result.spreadsheetId) {
        // Open the Google Sheets URL in a new tab
        window.open(`https://docs.google.com/spreadsheets/d/${result.spreadsheetId}`, '_blank');
      }
    } catch (err) {
      console.error('Error saving to Google Sheets:', err);
      setError(err instanceof Error ? err.message : 'Failed to save to Google Sheets');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleExportToCSV = async () => {
    try {
      if (!user) {
        setError('Please sign in to export cards');
        return;
      }

      setError('');
      setSuccess('');

      // Fetch all cards from the user's sheet
      const response = await fetch(apiUrl('/api/list-cards'), {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });

      // Check if response is JSON
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        if (text.includes('<html>') || text.includes('<!DOCTYPE')) {
          throw new Error('Authentication required. Please sign in again.');
        }
        throw new Error('Invalid response format from server');
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to fetch cards');
      }

      const result = await response.json();
      const allCards = result.cards || [];

      if (allCards.length === 0) {
        setError('No cards found to export');
        return;
      }

      // Define CSV headers
      const headers = [
        'Name', 'Company', 'Job Title', 'Email', 'Phone',
        'Website', 'Address', 'Social Links', 'Timestamp'
      ];

      // Map card data to CSV rows, handling both string and object data
      const rows = allCards.map((card: any) => {
        // Handle case where data might be a string that needs parsing
        const cardData = typeof card.data === 'string' ? JSON.parse(card.data) : (card.data || {});
        return [
          `"${cardData.name || ''}"`,
          `"${cardData.company || ''}"`,
          `"${cardData.job_title || ''}"`,
          `"${cardData.email || ''}"`,
          `"${cardData.phone || ''}"`,
          `"${cardData.website || ''}"`,
          `"${cardData.address || ''}"`,
          `"${(Array.isArray(cardData.social_links) ? cardData.social_links : []).join(', ')}"`,
          `"${card.timestamp || new Date().toISOString()}"`
        ];
      });

      // Create CSV content with BOM for Excel compatibility
      const csvContent = '\uFEFF' + [
        headers.join(','),
        ...rows.map((row: string[]) => row.join(','))
      ].join('\n');

      // Create and trigger download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `business_cards_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setSuccess(`Successfully exported ${allCards.length} cards to CSV`);
    } catch (err) {
      console.error('Export failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to export cards. Please try again.');
    }
  };

  const handleClearAll = () => {
    setProcessedCards([]);
    setError('');
    setSuccess('');
  };

  const handleAddToContacts = async (cardData: CardData) => {
    try {
      if (!user) {
        setError('Please sign in to add to Google Contacts');
        setShowSignInModal(true);
        return;
      }

      if (!cardData || Object.keys(cardData).length === 0) {
        throw new Error('Card data is required');
      }

      setError('');
      setSuccess('Adding to Google Contacts...');

      const response = await fetch(apiUrl('/api/add-to-contacts'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ cardData }), // Updated to match backend expectation
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to add to contacts');
      }

      const result = await response.json();

      // Redirect to Google Contacts after successful addition
      if (result.contactUrl) {
        window.open(result.contactUrl, '_blank');
      } else {
        // Fallback to Google Contacts main page if no specific contact URL is provided
        window.open('https://contacts.google.com', '_blank');
      }

      setSuccess('Contact added successfully!');

      setSuccess('Successfully added to Google Contacts!');
    } catch (err) {
      console.error('Error adding to contacts:', err);
      setError(err instanceof Error ? err.message : 'Failed to add to contacts');
    }
  };

  const listAllCards = async () => {
    setIsListing(true);
    setError('');

    try {
      const response = await fetch(apiUrl('/api/list-cards'), {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        try {
          const errorData = JSON.parse(errorText);
          throw new Error(errorData.error || 'Failed to fetch cards');
        } catch (e) {
          throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }
      }

      const result = await response.json();
      if (result && Array.isArray(result.cards)) {
        setListedCards(result.cards);
        setSuccess(`Successfully loaded ${result.cards.length} cards`);
      } else {
        setListedCards([]);
        setSuccess('No cards found');
      }
    } catch (err) {
      console.error('Error listing cards:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch cards');
    } finally {
      setIsListing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Fixed Sign In Button - Top Left */}
      {!user && (
        <div className="fixed top-4 right-4 z-50">
          <button
            onClick={handleGoogleSignIn}
            disabled={isSigningIn}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2 text-sm"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            {isSigningIn ? 'Signing in...' : 'Sign in with Google'}
          </button>
        </div>
      )}

      <div className="container mx-auto px-4 py-12">
        <div className="max-w-6xl mx-auto">
          {/* Header with User Info */}
          <div className="flex items-center justify-between mb-8">
            <div className="text-center flex-1">
              <h1 className="text-4xl font-bold text-slate-800 mb-3">
                Business Card Scanner
              </h1>
              <p className="text-slate-600">
                Upload single or multiple business card images to automatically extract contact information
              </p>
            </div>

            {user && (
              <div className="flex items-center gap-3 ml-4">
                <div className="flex items-center gap-3 bg-white rounded-lg px-4 py-2 shadow-md">
                  {user.picture && (
                    <img src={user.picture} alt={user.name} className="w-10 h-10 rounded-full" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-slate-800">{user.name}</p>
                    <p className="text-xs text-slate-500">{user.email}</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-8 mb-6">
            <div className="mb-8">
              <div className="mb-4">
                <h3 className="text-lg font-semibold text-slate-800 mb-2">Upload Business Cards</h3>
                <p className="text-sm text-slate-500">Upload images or PDFs of business cards to extract information</p>
              </div>

              <label
                htmlFor="file-upload"
                onClick={(e) => {
                  if (!user) {
                    e.preventDefault();
                    setShowSignInModal(true);
                  }
                }}
                className="flex flex-col items-center justify-center w-full h-64 border-3 border-dashed border-slate-300 rounded-xl cursor-pointer bg-slate-50 hover:bg-slate-100 transition-all duration-200"
              >
                <div className="flex flex-col items-center justify-center pt-5 pb-6">
                  <Upload className="w-12 h-12 text-slate-400 mb-4" />
                  <p className="mb-2 text-sm text-slate-600">
                    <span className="font-semibold">Click to upload</span> or drag and drop
                  </p>
                  <p className="text-xs text-slate-500">PNG, JPG, JPEG (Single or Multiple)</p>
                </div>
                <input
                  id="file-upload"
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={handleImageUpload}
                  disabled={isProcessing || !user}
                  multiple
                />
              </label>
            </div>

            {isProcessing && processingProgress && (
              <div className="flex flex-col items-center justify-center py-8">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin mr-3 mb-3" />
                <span className="text-slate-600">
                  Processing image {processingProgress.current} of {processingProgress.total}...
                </span>
              </div>
            )}

            {error && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-lg mb-6">
                <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            )}

            {success && (
              <div className="flex items-start gap-3 p-4 bg-green-50 border border-green-200 rounded-lg mb-6">
                <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                <p className="text-green-700 text-sm">{success}</p>
              </div>
            )}

            {processedCards.length > 0 && (
              <div className="space-y-6">
                <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                  <h3 className="text-xl font-semibold text-slate-800">
                    Extracted Cards ({processedCards.length})
                  </h3>
                  <button
                    onClick={handleClearAll}
                    className="flex items-center gap-2 text-red-600 hover:text-red-700 text-sm font-medium transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    Clear All
                  </button>
                </div>

                <div className="space-y-6 max-h-[600px] overflow-y-auto pr-2">
                  {processedCards.map((card) => (
                    <div key={card.id} className="border border-slate-200 rounded-xl p-6 bg-slate-50 relative">
                      <div className="absolute top-4 right-4 flex gap-2">
                        <button
                          onClick={() => handleRemoveCard(card.id)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Remove card"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-1">
                          <div className="rounded-lg overflow-hidden border border-slate-300 bg-white">
                            <img
                              src={card.previewUrl}
                              alt="Business card"
                              className="w-full h-auto object-contain"
                            />
                          </div>
                        </div>

                        <div className="lg:col-span-2">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {card.data.name && (
                              <div className="p-3 bg-white rounded-lg border border-slate-200">
                                <p className="text-xs font-medium text-slate-500 uppercase mb-1">Name</p>
                                <p className="text-slate-800 text-sm">{card.data.name}</p>
                              </div>
                            )}
                            {card.data.company && (
                              <div className="p-3 bg-white rounded-lg border border-slate-200">
                                <p className="text-xs font-medium text-slate-500 uppercase mb-1">Company</p>
                                <p className="text-slate-800 text-sm">{card.data.company}</p>
                              </div>
                            )}
                            {card.data.job_title && (
                              <div className="p-3 bg-white rounded-lg border border-slate-200">
                                <p className="text-xs font-medium text-slate-500 uppercase mb-1">Job Title</p>
                                <p className="text-slate-800 text-sm">{card.data.job_title}</p>
                              </div>
                            )}
                            {card.data.email && (
                              <div className="p-3 bg-white rounded-lg border border-slate-200">
                                <p className="text-xs font-medium text-slate-500 uppercase mb-1">Email</p>
                                <p className="text-slate-800 text-sm break-all">{card.data.email}</p>
                              </div>
                            )}
                            {card.data.phone && (
                              <div className="p-3 bg-white rounded-lg border border-slate-200">
                                <p className="text-xs font-medium text-slate-500 uppercase mb-1">Phone</p>
                                <p className="text-slate-800 text-sm">{card.data.phone}</p>
                              </div>
                            )}
                            {card.data.website && (
                              <div className="p-3 bg-white rounded-lg border border-slate-200">
                                <p className="text-xs font-medium text-slate-500 uppercase mb-1">Website</p>
                                <p className="text-slate-800 text-sm break-all">{card.data.website}</p>
                              </div>
                            )}
                            {card.data.address && (
                              <div className="p-3 bg-white rounded-lg border border-slate-200 md:col-span-2">
                                <p className="text-xs font-medium text-slate-500 uppercase mb-1">Address</p>
                                <p className="text-slate-800 text-sm">{card.data.address}</p>
                              </div>
                            )}
                            {card.data.social_links && card.data.social_links.length > 0 && (
                              <div className="p-3 bg-white rounded-lg border border-slate-200 md:col-span-2">
                                <p className="text-xs font-medium text-slate-500 uppercase mb-1">Social Links</p>
                                <p className="text-slate-800 text-sm break-all">{card.data.social_links.join(', ')}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap gap-4">
                  <button
                    onClick={handleExportToSheets}
                    disabled={processedCards.length === 0}
                    className="flex-1 min-w-[200px] flex items-center justify-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Save to Google Sheets
                  </button>

                  <button
                    onClick={handleExportToCSV}
                    disabled={processedCards.length === 0}
                    className="flex-1 min-w-[200px] flex items-center justify-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                    Export to CSV
                  </button>

                  <button
                    onClick={listAllCards}
                    disabled={isListing}
                    className="flex-1 min-w-[200px] flex items-center justify-center gap-2 px-6 py-3 bg-blue-100 hover:bg-blue-200 text-blue-700 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isListing ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                          <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
                        </svg>
                        List All Cards
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Display Listed Cards */}
          {listedCards.length > 0 && (
            <div className="mt-8">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">Your Cards ({listedCards.length})</h3>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {listedCards.map((card, index) => (
                  <div key={card.id || index} className="bg-white p-4 rounded-lg shadow-sm border border-gray-200 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h4 className="font-medium text-gray-900">{card.data?.name || 'No Name'}</h4>
                        {card.data?.company && <p className="text-sm text-gray-600">{card.data.company}</p>}
                        {card.data?.job_title && <p className="text-sm text-gray-500">{card.data.job_title}</p>}

                        <div className="mt-2 space-y-1">
                          {card.data?.email && (
                            <p className="text-sm">
                              <span className="text-gray-500">Email: </span>
                              <a href={`mailto:${card.data.email}`} className="text-blue-600 hover:underline">
                                {card.data.email}
                              </a>
                            </p>
                          )}

                          {card.data?.phone && (
                            <p className="text-sm">
                              <span className="text-gray-500">Phone: </span>
                              <a href={`tel:${card.data.phone.replace(/[^0-9+]/g, '')}`} className="text-gray-700">
                                {card.data.phone}
                              </a>
                            </p>
                          )}

                          {card.data?.website && (
                            <p className="text-sm">
                              <span className="text-gray-500">Website: </span>
                              <a
                                href={card.data.website.startsWith('http') ? card.data.website : `https://${card.data.website}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-500 hover:underline"
                              >
                                {card.data.website}
                              </a>
                            </p>
                          )}

                          {card.data?.address && (
                            <p className="text-sm text-gray-600 mt-1">
                              {card.data.address}
                            </p>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => handleAddToContacts(card.data)}
                        className="ml-2 p-2 text-blue-600 hover:bg-blue-50 rounded-full transition-colors"
                        title="Add to contacts"
                      >
                        <UserPlus className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="text-center text-sm text-slate-500 mt-8">
        <p>All extracted data is stored in your browser session</p>
      </div>
    </div>
  );
}

export default App;
