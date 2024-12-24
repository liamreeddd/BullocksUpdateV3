import React, {
    useState,
    useEffect,
    useRef,
    useCallback,
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { GoogleAIFileManager, GoogleAICacheManager } from '@google/generative-ai/server';

import { ChatService } from '../../services/chatService';
import { useChatStore } from '../../store/useChatStore';
import { Message } from '../../types/chat';
import { BUSINESS_ASSISTANT_PROMPT } from '../../config/chat';
import { Button } from '../../components/ui/Button';

const GeminiChatbot: React.FC = () => {
    // --- State Variables ---
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [uploadedFile, setUploadedFile] = useState<{
        uri: string;
        mimeType: string;
        name?: string;
    } | null>(null);
    const [fileAnalyzing, setFileAnalyzing] = useState(false);
    const [showClearChatModal, setShowClearChatModal] = useState(false);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
    const [transitioning, setTransitioning] = useState(false);

    // --- Refs ---
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const chatServiceRef = useRef<ChatService | null>(null);

    // --- Store ---
    const { addMessage, messages, clearMessages } = useChatStore();

    // --- Constants ---
    const suggestedQuestions = [
        "Let's make a promo for a product",
        "Let's brainstorm some marketing ideas",
        "What are some ways to boost employee productivity?",
        "How can we improve customer engagement?",
        "Can you help create a social media strategy?",
        "What are the latest business trends?",
        "How can we optimize our sales funnel?",
        "Give me ideas for team-building activities",
        "Help me write a professional email",
        "What are effective ways to handle customer complaints?",
    ];

    // --- Initialization Effect ---
     useEffect(() => {
        const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
        const MODEL_NAME = 'gemini-1.5-flash';

        if (!API_KEY) {
            setError('Gemini API key is missing.');
            return;
        }
        if (!chatServiceRef.current) {
            chatServiceRef.current = new ChatService({
                apiKey: API_KEY,
                model: MODEL_NAME,
                maxTokens: 1000,
            });
        }

        //syncing existing messages with chat service
        chatServiceRef.current?.replaceMessages(messages);

    }, [messages]);


    // --- File Upload Handler ---
    const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            setFileAnalyzing(true);
            const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
            if (!API_KEY) {
                setError('Gemini API key is missing.');
                return;
            }
            const fileManager = new GoogleAIFileManager(API_KEY);

           const uploadResult = await fileManager.uploadFile(
                file as any,
                {
                    mimeType: file.type,
                    displayName: file.name,
                }
            );

            setUploadedFile({
                uri: uploadResult.file.uri,
                mimeType: uploadResult.file.mimeType,
                name: file.name,
            });
        } catch (err) {
            console.error('Error uploading file:', err);
            setError('Error uploading file. Please try again.');
            setFileAnalyzing(false);
        }
    }, []);

    // --- Send Message Handler ---
   const handleSendMessage = useCallback(async (messageOverride?: string) => {
        const userMessageText = messageOverride ? messageOverride : inputValue.trim();
        if ((!userMessageText && !uploadedFile?.uri) || !chatServiceRef.current) return;

        setError(null);
        setInputValue('');

        const userMessage: Message = {
            id: uuidv4(),
            content: userMessageText,
            sender: 'user',
            timestamp: Date.now(),
            context: { sessionId: 'default' },
        };
        addMessage(userMessage);

        try {
            setIsLoading(true);
           let botMessage: Message | null = null;
            if (uploadedFile?.uri) {
               await analyzeFileAndRequestInstructions();

            }else{
               botMessage =  await sendMessageToGemini(userMessageText);
                 if (botMessage) {
                    addMessage(botMessage);
                 }
            }


        } catch (err) {
            handleChatError(err)
        } finally {
           setIsLoading(false);
        }
    }, [inputValue, addMessage, uploadedFile, fileAnalyzing]);


    const cacheFile = async (fileUri: string, mimeType: string, displayName: string) => {
        const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
        if (!API_KEY) {
            setError('Gemini API key is missing.');
            return null;
        }
        const cacheManager = new GoogleAICacheManager(API_KEY);
        const model = 'models/gemini-1.5-flash-001';
        const systemInstruction = 'You are an expert analyzing transcripts.';
        let ttlSeconds = 300;

        try {
            const cache = await cacheManager.create({
                model,
                displayName,
                systemInstruction,
                contents: [
                    {
                        role: 'user',
                        parts: [
                            {
                                fileData: {
                                    mimeType,
                                    fileUri,
                                },
                            },
                        ],
                    },
                ],
                ttlSeconds,
            });
            return cache;
        } catch (error) {
            console.error('Error creating cache:', error);
            return null;
        }
    };

    const analyzeFileAndRequestInstructions = async () => {
         if(!uploadedFile?.uri) return;

      try{
            const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEMINI_API_KEY);
            const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

            const prompt = `Provide a concise summary of the following file and then ask the user for further instructions on what they would like to do with the file. Format the response as JSON object with a "summary" and "instructionPrompt" property.`;

            let result;
            const cachedContent = await cacheFile(uploadedFile.uri, uploadedFile.mimeType, uploadedFile.name || 'uploaded file');
            if (cachedContent) {
                const genModel = genAI.getGenerativeModelFromCachedContent(cachedContent);
                 result = await genModel.generateContent({
                    contents: [
                        {
                            role: 'user',
                            parts: [
                                {
                                    text: prompt,
                                },
                            ],
                        },
                    ],
                });
            } else {
                 result = await model.generateContent([
                    prompt,
                    {
                        fileData: {
                            fileUri: uploadedFile.uri,
                            mimeType: uploadedFile.mimeType,
                        },
                    },
                ]);
            }


            try{
               const response  =  JSON.parse(result.response.text());
               const {summary, instructionPrompt} = response;

                  const analysisResultMessage: Message = {
                        id: uuidv4(),
                        content: summary,
                        sender: 'ai',
                        timestamp: Date.now(),
                        context: { sessionId: 'default' },
                    };
                  addMessage(analysisResultMessage);

                  if(instructionPrompt){
                     const analysisQuestionMessage: Message = {
                        id: uuidv4(),
                        content: instructionPrompt,
                        sender: 'ai',
                        timestamp: Date.now(),
                        context: { sessionId: 'default' },
                    };
                      addMessage(analysisQuestionMessage);
                 }


            }catch(e){
                 console.error("Error parsing response from Gemini, response is not a JSON object")
                handleChatError(e);
            }


            setFileAnalyzing(false);
             setUploadedFile(null);
        }catch(e){
            handleChatError(e);
        }
    }

     const sendMessageToGemini = async (userMessageText:string) : Promise<Message| null> => {
      if(!chatServiceRef.current) return null;

        const apiResponse = await chatServiceRef.current.generateResponse(
                    userMessageText,
                    BUSINESS_ASSISTANT_PROMPT,
                    (text) => {
                        // This callback is called when new text is received from the stream
                        // You can use this to update the UI in real-time if needed
                    }
                );
                if (apiResponse?.text) {
                    return {
                        id: uuidv4(),
                        content: apiResponse.text,
                        sender: 'ai',
                        timestamp: Date.now(),
                        context: { sessionId: 'default' },
                    };
                }
        return null;
    }
    const handleChatError = (err:any) =>{
            console.error('Error in chat:', err);
                setError(err instanceof Error ? err.message : 'An error occurred during the conversation');

                const errorMessage: Message = {
                    id: uuidv4(),
                    content: 'I apologize, but I encountered an error. Please try again.',
                    sender: 'ai',
                    timestamp: Date.now(),
                    context: { sessionId: 'default' },
                };
                addMessage(errorMessage);
        }


    // --- Scroll to Bottom Effect ---
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [messages]);

    // --- Input Change Handler ---
    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value);
    }, []);

    // --- Input Keydown Handler ---
    const handleInputKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSendMessage();
            }
        },
        [handleSendMessage]
    );

    // --- Clear Chat Handlers ---
    const handleClearChat = useCallback(() => {
        setShowClearChatModal(true);
    }, []);

    const handleConfirmClearChat = useCallback(() => {
        clearMessages();
        setShowClearChatModal(false);
    }, [clearMessages]);

    const handleCancelClearChat = useCallback(() => {
        setShowClearChatModal(false);
    }, []);

    // --- Suggested Question Rotation Effect ---
    useEffect(() => {
        const interval = setInterval(() => {
            setTransitioning(true);
            setTimeout(() => {
                setCurrentQuestionIndex((prevIndex) => (prevIndex + 1) % suggestedQuestions.length);
                setTransitioning(false);
            }, 500);
        }, 10000);
        return () => clearInterval(interval);
    }, [suggestedQuestions.length]);

    // --- Send Button Click Handler ---
    const handleSendButtonClick = useCallback(() => {
      handleSendMessage();
    }, [handleSendMessage]);

    // --- Render ---
    return (
        <div className="flex flex-col h-full bg-dark-500 w-full max-w-sm sm:max-w-full mx-auto">
            {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4">
                    <span className="block sm:inline">{error}</span>
                </div>
            )}

            <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-6 space-y-4">
                {messages.map((message) => (
                    <div
                        key={message.id}
                        className={`flex ${
                            message.sender === 'user' ? 'justify-end' : message.sender === 'ai' ? 'justify-start' : 'justify-center italic text-gray-400'
                        }`}
                    >
                        <div
                            className={`max-w-[80%] p-3 rounded-lg shadow-md ${
                                message.sender === 'user'
                                    ? 'bg-gradient-to-r from-blue-500 to-blue-700 text-white rounded-br-none'
                                    : message.sender === 'ai'
                                      ? 'bg-gradient-to-r from-teal-500 to-teal-700 text-black rounded-bl-none'
                                      : 'bg-gray-700 text-gray-400'
                            }`}
                        >
                            <div className="whitespace-pre-wrap break-words">{message.content}</div>
                        </div>
                    </div>
                ))}

            </div>

            <div className="border-t border-gray-700 bg-gray-800 p-4 z-10">
                <div
                    className={`pb-2 transition-opacity duration-500 ${
                        transitioning ? 'opacity-0' : 'opacity-100'
                    }`}
                >
                    <button
                        onClick={() => setInputValue(suggestedQuestions[currentQuestionIndex])}
                        className="px-4 py-2 shadow-md text-white rounded-full text-sm transition-colors hover:bg-blue-700 border-2 border-teal-500 bg-transparent text-teal-500 hover:text-white"
                    >
                        {suggestedQuestions[currentQuestionIndex]}
                    </button>
                </div>
                <div className="flex gap-2 relative mt-2">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={handleInputChange}
                        onKeyDown={handleInputKeyDown}
                        placeholder="Type your message..."
                        disabled={isLoading || fileAnalyzing}
                        className="flex-1 min-w-0 px-4 py-2 text-white bg-gray-900 shadow-md border-none rounded-full focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                    <Button
                         onClick={handleSendButtonClick}
                        disabled={isLoading || fileAnalyzing}
                        className="mx-1"
                        title="Send"
                        size="icon"
                    >
                        {isLoading ? (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-4 h-4 animate-spin">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M16.023 9.348l-.003-.001a9.348 9.348 0 01-.53 1.175M16.025 9.348l.001-.002 1.01-1.01a4.674 4.674 0 00-1.39-.757M16.023 9.348l-.004.006-.713.712a4.674 4.674 0 01-.9.342M15.018 10.355a4.674 4.674 0 01-1.389-.757l-1.01-1.01a9.348 9.348 0 012.932 3.592m-1.514 2.028a4.674 4.674 0 01-.9.342l-.715.712a9.348 9.348 0 01-1.891 1.175m1.734 1.734a9.348 9.348 0 01-1.518 1.175l-.003-.003a9.348 9.348 0 01-.53 1.175m1.514 2.028a4.674 4.674 0 01-.9.342l-.715.712a4.674 4.674 0 01-.9.342m.002 1.006a4.674 4.674 0 01-.9.342l-.715.712a9.348 9.348 0 01-1.891 1.175m1.734 1.734a9.348 9.348 0 01-1.518 1.175l-.003-.003a9.348 9.348 0 01-.53 1.175" />
                            </svg>
                        ) : (
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-4 h-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.769 59.769 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                            </svg>
                        )}
                    </Button>
                    <div className="flex items-center">
                        <Button
                            className="mx-1 relative"
                            title="Upload File"
                            size="icon"
                            variant="outline"
                        >
                            <input
                                type="file"
                                id="fileUpload"
                                disabled={isLoading}
                                onChange={handleFileUpload}
                                className="opacity-0 z-10 absolute w-[100%] h-[100%]"
                            />
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-4 h-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M6 7.5h12" />
                            </svg>
                        </Button>
                        <Button
                            onClick={handleClearChat}
                            disabled={isLoading}
                            className="mx-1"
                            title="Clear Chat"
                            size="icon"
                            variant="destructive"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor" className="w-4 h-4">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m6-6H6" />
                            </svg>
                        </Button>
                    </div>
                </div>
            </div>
             {showClearChatModal && (
                <div className="fixed inset-0 bg-gray-900 bg-opacity-75 overflow-y-auto h-full w-full flex items-center justify-center">
                    <div className="bg-dark-700 rounded-lg shadow-xl p-6">
                        <p className="text-lg font-semibold mb-4 text-teal-500">Are you sure you want to clear the chat?</p>
                        <div className="flex justify-end gap-4">
                            <Button onClick={handleCancelClearChat} variant="outline">Cancel</Button>
                            <Button onClick={handleConfirmClearChat} variant="destructive">Clear</Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default GeminiChatbot;
