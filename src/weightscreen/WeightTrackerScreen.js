import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Dimensions,
  FlatList,
  Image,
  Alert as RNAlert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { LineChart } from "react-native-chart-kit";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { OnboardingContext } from "../context/OnboardingContext";
import supabase from "../lib/supabase";

// Add this import for AdaptiveGoalEngine
// import { AdaptiveGoalEngine } from "../path/to/AdaptiveGoalEngine";

// Global cache for WeightTrackerScreen (Instagram pattern)
const globalWeightCache = {
  isFetching: false,
  lastFetchTime: 0,
  CACHE_DURATION: 60000, // 60 seconds
  cachedData: null,
};

const PRIMARY = "#7B61FF";
const CARD_BG = "#F8F6FC";
const ACCENT_GREEN = "#1abc9c";
const ACCENT_RED = "#e74c3c";
const GRAY = "#888";
const WHITE = "#fff";

// Memoized utility functions
const formatDate = (dateStr) => {
  try {
    if (!dateStr) return 'N/A';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return 'Invalid Date';
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch (error) {
    console.error('Error formatting date:', error);
    return 'N/A';
  }
};

// Weight trend analysis functions
const generateTrendAnalysis = (logs) => {
  try {
    if (!logs || !Array.isArray(logs) || logs.length < 2) {
      return { message: 'Need at least 2 weight entries to analyze trends' };
    }
    
    const sortedLogs = [...logs]
      .filter(log => log && log.date && log.weight !== undefined && log.weight !== null)
      .sort((a, b) => {
        try {
          return new Date(a.date) - new Date(b.date);
        } catch {
          return 0;
        }
      });
    
    if (sortedLogs.length < 2) {
      return { message: 'Need at least 2 valid weight entries to analyze trends' };
    }
    
    const weights = sortedLogs.map(log => Number(log.weight)).filter(w => !isNaN(w));
    const dates = sortedLogs.map(log => {
      try {
        const d = new Date(log.date);
        return isNaN(d.getTime()) ? null : d;
      } catch {
        return null;
      }
    }).filter(d => d !== null);
    
    if (weights.length < 2 || dates.length < 2) {
      return { message: 'Invalid weight or date data' };
    }
    
    // Calculate trend using linear regression
    const n = Math.min(weights.length, dates.length);
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    
    for (let i = 0; i < n; i++) {
      const x = i;
      const y = weights[i];
      if (isNaN(y)) continue;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }
    
    const denominator = (n * sumX2 - sumX * sumX);
    if (denominator === 0) {
      return { message: 'Cannot calculate trend with current data' };
    }
    
    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;
    
    // Calculate weekly change
    const weeklyChange = isNaN(slope) ? 0 : slope * 7;
    
    // Calculate total change
    const totalChange = weights.length > 0 && dates.length > 0 
      ? (weights[weights.length - 1] - weights[0])
      : 0;
    const totalDays = dates.length > 1 
      ? (dates[dates.length - 1] - dates[0]) / (1000 * 60 * 60 * 24)
      : 0;
    
    return {
      slope: isNaN(slope) ? 0 : slope,
      intercept: isNaN(intercept) ? 0 : intercept,
      weeklyChange: isNaN(weeklyChange) ? 0 : weeklyChange,
      totalChange: isNaN(totalChange) ? 0 : totalChange,
      totalDays: Math.round(totalDays) || 0,
      trend: weeklyChange > 0.1 ? 'increasing' : weeklyChange < -0.1 ? 'decreasing' : 'stable',
      confidence: n >= 7 ? 'high' : n >= 3 ? 'medium' : 'low',
      message: `Based on ${n} weight entries over ${Math.round(totalDays) || 0} days`
    };
  } catch (error) {
    console.error('Error generating trend analysis:', error);
    return { message: 'Error analyzing trends' };
  }
};

const generateWeightInsights = (logs, profile) => {
  const insights = [];
  
  if (!logs || logs.length < 2) {
    insights.push({
      type: 'general',
      priority: 'low',
      title: 'Start Tracking',
      message: 'Log more weight entries to get personalized insights!',
      icon: '📊',
      action: 'Keep logging your weight regularly'
    });
    return insights;
  }
  
  const analysis = generateTrendAnalysis(logs);
  const sortedLogs = [...logs].sort((a, b) => new Date(a.date) - new Date(b.date));
  const recentWeights = sortedLogs.slice(-7); // Last 7 entries
  
  // Trend insights
  if (analysis.trend === 'increasing' && analysis.weeklyChange > 0.5) {
    insights.push({
      type: 'trend',
      priority: 'high',
      title: 'Weight Gain Trend',
      message: `You've gained ${analysis.weeklyChange.toFixed(1)}kg per week on average.`,
      icon: '📈',
      action: 'Consider adjusting your calorie intake or activity level'
    });
  } else if (analysis.trend === 'decreasing' && analysis.weeklyChange < -0.5) {
    insights.push({
      type: 'trend',
      priority: 'high',
      title: 'Weight Loss Trend',
      message: `You're losing ${Math.abs(analysis.weeklyChange).toFixed(1)}kg per week on average.`,
      icon: '📉',
      action: 'Great progress! Consider if this rate is sustainable'
    });
  } else if (analysis.trend === 'stable') {
    insights.push({
      type: 'trend',
      priority: 'low',
      title: 'Stable Weight',
      message: 'Your weight has been stable recently.',
      icon: '⚖️',
      action: 'Maintaining weight is great for overall health!'
    });
  }
  
  // Goal-based insights
  if (profile?.goal === 'weightLoss' && analysis.trend === 'increasing') {
    insights.push({
      type: 'goal',
      priority: 'high',
      title: 'Goal Mismatch',
      message: 'You\'re gaining weight but your goal is weight loss.',
      icon: '🎯',
      action: 'Consider reviewing your calorie deficit and exercise routine'
    });
  } else if (profile?.goal === 'weightGain' && analysis.trend === 'decreasing') {
    insights.push({
      type: 'goal',
      priority: 'high',
      title: 'Goal Mismatch',
      message: 'You\'re losing weight but your goal is weight gain.',
      icon: '🎯',
      action: 'Consider increasing your calorie intake'
    });
  }
  
  // Consistency insights
  const weightVariations = recentWeights.map((log, i) => {
    if (i === 0) return 0;
    return Math.abs(log.weight - recentWeights[i-1].weight);
  }).filter(v => v > 0);
  
  const avgVariation = weightVariations.reduce((sum, v) => sum + v, 0) / weightVariations.length;
  
  if (avgVariation > 1.5) {
    insights.push({
      type: 'consistency',
      priority: 'medium',
      title: 'High Weight Variability',
      message: `Your weight varies by ${avgVariation.toFixed(1)}kg on average between entries.`,
      icon: '📊',
      action: 'Try weighing at the same time of day for more consistent readings'
    });
  }
  
  return insights;
};

// Cache for signed URLs to prevent regeneration
const signedUrlCache = new Map();

// Weight Log Item Component
const WeightLogItem = React.memo(({ item, index, logs, weightData, handleDeleteLog, handleDeleteLogByDate }) => {
  // Component implementation
  const [imageUrl, setImageUrl] = useState(null);
  
  useEffect(() => {
    try {
      if (!item || !item.photo_url) {
        setImageUrl(null);
        return;
      }
      
      const photoUrl = item.photo_url;
      
      // If already a full URL, use directly
      if (typeof photoUrl === 'string' && photoUrl.startsWith('http')) {
        setImageUrl(photoUrl);
        return;
      }
      
      // Check cache first
      if (signedUrlCache.has(photoUrl)) {
        setImageUrl(signedUrlCache.get(photoUrl));
        return;
      }
      
      // Generate signed URL only if not cached
      const createSignedUrl = async () => {
        try {
          const { data, error } = await supabase.storage
            .from('weight-photos')
            .createSignedUrl(photoUrl, 60 * 60 * 24 * 365); // 1 year expiry
          if (error) {
            console.log('Signed URL error:', error);
            // Try fallback with public URL (in case bucket becomes public later)
            try {
              const publicUrl = supabase.storage.from('weight-photos').getPublicUrl(photoUrl).publicUrl;
              if (publicUrl) {
                signedUrlCache.set(photoUrl, publicUrl);
                setImageUrl(publicUrl);
              } else {
                setImageUrl(null);
              }
            } catch (fallbackError) {
              console.log('Public URL fallback failed:', fallbackError);
              setImageUrl(null);
            }
          } else {
            const signedUrl = data?.signedUrl || null;
            if (signedUrl) {
              signedUrlCache.set(photoUrl, signedUrl);
              setImageUrl(signedUrl);
            } else {
              setImageUrl(null);
            }
          }
        } catch (err) {
          console.log('Signed URL generation failed:', err);
          // Try fallback with public URL
          try {
            const publicUrl = supabase.storage.from('weight-photos').getPublicUrl(photoUrl).publicUrl;
            if (publicUrl) {
              signedUrlCache.set(photoUrl, publicUrl);
              setImageUrl(publicUrl);
            } else {
              setImageUrl(null);
            }
          } catch (fallbackError) {
            console.log('Public URL fallback failed:', fallbackError);
            setImageUrl(null);
          }
        }
      };
      createSignedUrl();
    } catch (error) {
      console.error('Error in WeightLogItem useEffect:', error);
      setImageUrl(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.photo_url]); // Only depend on photo_url, not the entire item object
  
  // Calculate weight change from previous entry
  try {
    const safeLogs = Array.isArray(logs) ? logs : [];
    const safeWeightData = weightData || { weightUnit: "kg" };
    const previousWeight = index < safeLogs.length - 1 && safeLogs[index + 1]?.weight !== undefined 
      ? safeLogs[index + 1].weight 
      : null;
    const itemWeight = item?.weight !== undefined && item?.weight !== null ? Number(item.weight) : 0;
    const prevWeight = previousWeight !== null ? Number(previousWeight) : null;
    const weightChange = prevWeight !== null ? (itemWeight - prevWeight) : 0;
    const isWeightLoss = weightChange < 0;
  
    const safeItemWeight = isNaN(itemWeight) ? 0 : itemWeight;
    const safeWeightChange = isNaN(weightChange) ? 0 : weightChange;
    
    return (
      <View style={styles.historyItem}>
        <View style={styles.historyItemContent}>
          {/* Image placeholder on the left */}
          <View style={styles.imagePlaceholder}>
            {imageUrl ? (
              <Image 
                source={{ uri: imageUrl }} 
                style={styles.historyImage}
                resizeMode="cover"
                onError={(error) => {
                  console.log('Image load error:', error);
                  setImageUrl(null);
                }}
                onLoad={() => {
                  // Image loaded successfully
                }}
              />
            ) : (
              <Ionicons name="camera" size={24} color="#9CA3AF" />
            )}
          </View>
          
          {/* Weight details in the middle */}
          <View style={styles.weightDetails}>
            <Text style={styles.historyWeight}>
              {safeItemWeight.toFixed(1)} {safeWeightData.weightUnit || "kg"}
            </Text>
            <Text style={styles.historyDate}>{formatDate(item?.date)}</Text>
            {item?.note ? (
              <Text style={styles.historyNote}>{item.note}</Text>
            ) : (
              <Text style={styles.historyNote}>{item?.emoji || "😊"} Feeling great!</Text>
            )}
          </View>
          
          {/* Weight change on the right */}
          <View style={styles.weightChangeContainer}>
            {safeWeightChange !== 0 && !isNaN(safeWeightChange) && (
              <Text style={[
                styles.weightChangeText,
                { color: isWeightLoss ? ACCENT_GREEN : ACCENT_RED }
              ]}>
                {isWeightLoss ? '' : '+'}{safeWeightChange.toFixed(1)} {safeWeightData.weightUnit || "kg"}
              </Text>
            )}
            <TouchableOpacity
              onPress={() => {
                try {
                  if (item?.id) {
                    handleDeleteLog(item.id);
                  } else if (item?.user_id && item?.date) {
                    // Fallback: use user_id and date combination
                    handleDeleteLogByDate(item.user_id, item.date);
                  } else {
                    Alert.alert('Error', 'Cannot delete entry - missing ID');
                  }
                } catch (error) {
                  console.error('Error in delete handler:', error);
                  Alert.alert('Error', 'Failed to delete entry');
                }
              }}
              style={styles.deleteButton}
            >
              <Ionicons name="trash" size={18} color="#9CA3AF" />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  } catch (error) {
    console.error('Error rendering WeightLogItem:', error);
    return (
      <View style={styles.historyItem}>
        <Text style={styles.historyNote}>Error loading entry</Text>
      </View>
    );
  }
}, (prevProps, nextProps) => {
  // Custom comparison to prevent unnecessary re-renders
  return (
    prevProps.item?.id === nextProps.item?.id &&
    prevProps.item?.photo_url === nextProps.item?.photo_url &&
    prevProps.item?.weight === nextProps.item?.weight &&
    prevProps.item?.date === nextProps.item?.date &&
    prevProps.item?.note === nextProps.item?.note &&
    prevProps.item?.emoji === nextProps.item?.emoji &&
    prevProps.weightData?.weightUnit === nextProps.weightData?.weightUnit &&
    prevProps.index === nextProps.index
  );
});
WeightLogItem.displayName = 'WeightLogItem';

const WeightTrackerScreen = ({ navigation }) => {
  const insets = useSafeAreaInsets(); // Get safe area insets for bottom navigation
  const context = useContext(OnboardingContext);
  const onboardingData = context?.onboardingData || {};
  const setOnboardingData = context?.setOnboardingData || (() => {});
  
  // Initialize state with cached data (Instagram pattern)
  const [logs, setLogs] = useState(() => globalWeightCache.cachedData?.logs || []);
  const [refreshing, setRefreshing] = useState(false);
  const [userProfile, setUserProfile] = useState(() => globalWeightCache.cachedData?.userProfile || null);
  
  // Weight trend analysis
  const [trendAnalysis, setTrendAnalysis] = useState(null);
  const [weightInsights, setWeightInsights] = useState([]);
  const [goalEngine, setGoalEngine] = useState(null);
  
  // Get userId from Supabase Auth
  const [userId, setUserId] = useState(null);
  
  // Memoize userId fetch to prevent multiple calls
  useEffect(() => {
    let isMounted = true;
    
    const getUserId = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (isMounted) {
          setUserId(session?.user?.id || null);
        }
      } catch (error) {
        console.error('Error getting user ID:', error);
      }
    };
    
    getUserId();
    
    return () => {
      isMounted = false;
    };
  }, []);

  // Optimized fetch function with proper error handling and batched updates
  const fetchData = useCallback(async () => {
    if (!userId || globalWeightCache.isFetching) return;
    
    globalWeightCache.isFetching = true;
    
    try {
      // Fetch user profile and logs in parallel
      const [profileResult, logsResult] = await Promise.all([
        supabase
          .from("user_profile")
          .select("weight, target_weight, weight_unit, height, age, gender, activity_level, goal")
          .eq("id", userId)
          .single(),
        supabase
          .from("weight_logs")
          .select("*")
          .eq("user_id", userId)
          .order("date", { ascending: false })
      ]);
      
      const { data: profile, error: profileError } = profileResult;
      const { data: logsData, error: logsError } = logsResult;
      
      // Batch all state updates to prevent multiple re-renders
      const updates = {};
      
      if (!profileError && profile) {
        updates.userProfile = profile;
        
        // Update onboarding data only if needed
        setOnboardingData((prev) => ({
          ...prev,
          weight: profile.weight || prev.weight,
          target_weight: profile.target_weight || prev.target_weight,
          selectedWeightUnit: profile.weight_unit || prev.selectedWeightUnit || "kg",
        }));
      }
      
      if (!logsError && logsData) {
        console.log('Raw logs data from database:', logsData);
        console.log('First log item fields:', logsData[0] ? Object.keys(logsData[0]) : 'No logs');
        updates.logs = logsData;
        
        // Only create goal engine and analysis if data exists
        if (logsData.length > 0) {
          /* Uncomment when AdaptiveGoalEngine is available
          const userProfileData = {
            weight: logsData[0].weight || 70,
            height: profile?.height || 170,
            age: profile?.age || 25,
            gender: profile?.gender || 'male',
            activityLevel: profile?.activity_level || 'moderate',
            goal: profile?.goal || 'maintenance',
            history: [],
            weightHistory: logsData.map(log => ({ weight: log.weight, date: log.date }))
          };
          
          updates.goalEngine = new AdaptiveGoalEngine(userProfileData);
          */
          updates.trendAnalysis = generateTrendAnalysis(logsData);
          updates.weightInsights = generateWeightInsights(logsData, profile);
        }
      }
      
      // Apply all updates atomically
      if (updates.userProfile) setUserProfile(updates.userProfile);
      if (updates.logs) setLogs(updates.logs);
      if (updates.goalEngine) setGoalEngine(updates.goalEngine);
      if (updates.trendAnalysis) setTrendAnalysis(updates.trendAnalysis);
      if (updates.weightInsights) setWeightInsights(updates.weightInsights);
      
      // Update cache
      globalWeightCache.cachedData = {
        logs: updates.logs || logs,
        userProfile: updates.userProfile || userProfile,
      };
      globalWeightCache.lastFetchTime = Date.now();
      
    } catch (error) {
      console.error('Fetch error:', error);
    } finally {
      globalWeightCache.isFetching = false;
    }
  }, [userId, setOnboardingData]);

  // Optimized useFocusEffect with proper caching
  useFocusEffect(
    useCallback(() => {
      if (!userId) return;
      
      const now = Date.now();
      const timeSinceLastFetch = now - globalWeightCache.lastFetchTime;
      
      // Check cache - if fresh, restore from cache and skip fetch
      if (timeSinceLastFetch < globalWeightCache.CACHE_DURATION && globalWeightCache.cachedData) {
        const { logs: cachedLogs, userProfile: cachedProfile } = globalWeightCache.cachedData;
        
        // Only update state if it's different (prevent unnecessary re-renders)
        if (JSON.stringify(cachedLogs) !== JSON.stringify(logs)) {
          setLogs(cachedLogs || []);
        }
        if (JSON.stringify(cachedProfile) !== JSON.stringify(userProfile)) {
          setUserProfile(cachedProfile || null);
        }
        return; // Use cached data
      }
      
      // Fetch fresh data
      fetchData();
    }, [userId, refreshing, fetchData]) // Removed setOnboardingData to prevent dependency loops
  );

  // Refresh after adding new weight with debounced effect
  useEffect(() => {
    const unsubscribe = navigation.addListener("focus", () => {
      // Add a small delay to prevent multiple rapid refreshes
      const timeoutId = setTimeout(() => {
        setRefreshing((r) => !r);
      }, 100);
      
      return () => clearTimeout(timeoutId);
    });
    
    return unsubscribe;
  }, [navigation]);

  // Memoized weight calculations
  const weightData = useMemo(() => {
    try {
      const weightUnit = userProfile?.weight_unit || onboardingData?.selectedWeightUnit || "kg";
      let currentWeight = 0;
      
      if (userProfile?.weight !== undefined && userProfile?.weight !== null) {
        const weightNum = Number(userProfile.weight);
        currentWeight = !isNaN(weightNum) ? weightNum : 0;
      } else if (logs && Array.isArray(logs) && logs.length > 0 && logs[0]?.weight !== undefined && logs[0]?.weight !== null) {
        const weightNum = Number(logs[0].weight);
        currentWeight = !isNaN(weightNum) ? weightNum : 0;
      }
      
      // Weekly change calculation
      let weeklyChange = 0;
      if (logs && Array.isArray(logs) && logs.length > 0 && currentWeight > 0) {
        try {
          const today = new Date();
          const weekAgo = new Date(today);
          weekAgo.setDate(today.getDate() - 7);
          
          let closest = null;
          let minDiff = Infinity;
          
          for (let log of logs) {
            if (!log || !log.date) continue;
            try {
              const logDate = new Date(log.date);
              if (isNaN(logDate.getTime())) continue;
              const diff = Math.abs(logDate - weekAgo);
              if (diff < minDiff) {
                minDiff = diff;
                closest = log;
              }
            } catch (err) {
              console.error('Error processing log date:', err);
              continue;
            }
          }
          
          if (closest && closest.weight !== undefined && closest.weight !== null) {
            const closestWeightNum = Number(closest.weight);
            if (!isNaN(closestWeightNum)) {
              const change = currentWeight - closestWeightNum;
              weeklyChange = !isNaN(change) ? Number(change.toFixed(1)) : 0;
            }
          }
        } catch (error) {
          console.error('Error calculating weekly change:', error);
          weeklyChange = 0;
        }
      }
      
      return { 
        weightUnit: weightUnit || "kg", 
        currentWeight: currentWeight || 0, 
        weeklyChange: weeklyChange || 0 
      };
    } catch (error) {
      console.error('Error calculating weight data:', error);
      return { weightUnit: "kg", currentWeight: 0, weeklyChange: 0 };
    }
  }, [userProfile, onboardingData, logs]);

  // Memoized chart data and configuration
  const chartData = useMemo(() => {
    try {
      const screenWidth = Math.max(Dimensions.get('window').width - 32, 300);
    
    // Helper function to get week number in month
    const getWeekOfMonth = (date) => {
      const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      const dayOfMonth = date.getDate();
      const weekNum = Math.ceil((dayOfMonth + startOfMonth.getDay()) / 7);
      return weekNum;
    };

    // Generate current month's weekly data
    const generateWeeklyData = () => {
      const today = new Date();
      const weeks = [];
      const dataPoints = [];
      
      // Use current weight as the baseline
      const baseWeight = weightData.currentWeight || 0;
      
      // Get current month info
      const currentMonth = today.getMonth();
      const currentYear = today.getFullYear();
      const monthName = today.toLocaleDateString(undefined, { month: 'short' });
      
      // Calculate number of weeks in current month (usually 4-5 weeks)
      const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);
      const weeksInMonth = getWeekOfMonth(lastDayOfMonth);
      
      // Generate data for each week in the current month
      for (let weekNum = 1; weekNum <= weeksInMonth; weekNum++) {
        // Find first day of this week in the month
        let weekDate = null;
        for (let day = 1; day <= lastDayOfMonth.getDate(); day++) {
          const date = new Date(currentYear, currentMonth, day);
          if (getWeekOfMonth(date) === weekNum) {
            weekDate = date;
            break;
          }
        }
        
        if (weekDate) {
          // Find if there's a weight log for this week
          const weekStart = new Date(weekDate);
          weekStart.setDate(weekDate.getDate() - weekDate.getDay());
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekStart.getDate() + 6);
          
          // Find log in this week
          const logInWeek = logs.find(log => {
            const logDate = new Date(log.date);
            logDate.setHours(0, 0, 0, 0);
            const weekStartCopy = new Date(weekStart);
            weekStartCopy.setHours(0, 0, 0, 0);
            const weekEndCopy = new Date(weekEnd);
            weekEndCopy.setHours(23, 59, 59, 999);
            
            return logDate >= weekStartCopy && logDate <= weekEndCopy;
          });
          
          let weightValue;
          if (logInWeek) {
            const weight = Number(logInWeek.weight);
            weightValue = weightData.weightUnit === 'lbs' ? Number((weight * 2.20462).toFixed(1)) : weight;
          } else {
            weightValue = 0;
          }
          
          // Add month name only for the first week, then just week numbers
          if (weekNum === 1) {
            weeks.push(`${monthName} W${weekNum}`);
          } else {
            weeks.push(`W${weekNum}`);
          }
          dataPoints.push(weightValue);
        }
      }
      
      return { weeks, dataPoints };
    };

      // Get weight entries for chart
      let chartWeightData = [];
      let chartLabels = [];
      
      if (logs && Array.isArray(logs) && (logs.length > 0 || (weightData?.currentWeight && weightData.currentWeight > 0))) {
        try {
          const { weeks, dataPoints } = generateWeeklyData();
          chartLabels = Array.isArray(weeks) && weeks.length > 0 ? weeks : [''];
          chartWeightData = Array.isArray(dataPoints) && dataPoints.length > 0 
            ? dataPoints.filter(d => !isNaN(d) && isFinite(d))
            : [0];
        } catch (error) {
          console.error('Error generating weekly data:', error);
          chartWeightData = [0];
          chartLabels = [''];
        }
      } else {
        chartWeightData = [0];
        chartLabels = [''];
      }
      
      // Ensure we have valid data for the chart
      if (chartWeightData.length === 0 || chartLabels.length === 0) {
        chartWeightData = [0];
        chartLabels = [''];
      }
      
      // Ensure arrays are the same length
      const minLength = Math.min(chartWeightData.length, chartLabels.length);
      chartWeightData = chartWeightData.slice(0, minLength);
      chartLabels = chartLabels.slice(0, minLength);
      
      return {
        data: {
          labels: chartLabels.length > 0 ? chartLabels : [''],
          datasets: [
            {
              data: chartWeightData.length > 0 ? chartWeightData : [0],
              color: (opacity = 1) => `rgba(123, 97, 255, ${opacity})`,
              strokeWidth: 2,
            },
          ],
        },
        config: {
          backgroundColor: '#F8FAFC',
          backgroundGradientFrom: '#F8FAFC',
          backgroundGradientTo: '#F8FAFC',
          decimalPlaces: 0,
          color: (opacity = 1) => `rgba(123, 97, 255, ${opacity})`,
          labelColor: (opacity = 1) => `rgba(102, 102, 102, ${opacity})`,
          propsForDots: { r: '4', strokeWidth: '2', stroke: '#7B61FF' },
          propsForBackgroundLines: {
            strokeDasharray: '',
            stroke: '#E5E7EB',
            strokeWidth: 1,
          },
        },
        screenWidth: Math.max(screenWidth, 300)
      };
    } catch (error) {
      console.error('Error generating chart data:', error);
      return {
        data: {
          labels: [''],
          datasets: [{ data: [0], color: (opacity = 1) => `rgba(123, 97, 255, ${opacity})`, strokeWidth: 2 }],
        },
        config: {
          backgroundColor: '#F8FAFC',
          backgroundGradientFrom: '#F8FAFC',
          backgroundGradientTo: '#F8FAFC',
          decimalPlaces: 0,
          color: (opacity = 1) => `rgba(123, 97, 255, ${opacity})`,
          labelColor: (opacity = 1) => `rgba(102, 102, 102, ${opacity})`,
          propsForDots: { r: '4', strokeWidth: '2', stroke: '#7B61FF' },
          propsForBackgroundLines: {
            strokeDasharray: '',
            stroke: '#E5E7EB',
            strokeWidth: 1,
          },
        },
        screenWidth: 300
      };
    }
  }, [logs, weightData]);

  // Memoized delete handler
  const handleDeleteLog = useCallback(async (logId) => {
    console.log('handleDeleteLog called with logId:', logId);
    console.log('logId type:', typeof logId);
    
    if (!logId) {
      Alert.alert("Error", "Cannot delete entry - missing ID");
      return;
    }
    
    RNAlert.alert(
      "Delete Entry",
      "Are you sure you want to delete this weight entry?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              console.log('Attempting to delete log with ID:', logId);
              const { error } = await supabase
                .from("weight_logs")
                .delete()
                .eq("id", logId);
              if (error) {
                console.error('Delete error:', error);
                Alert.alert("Error", error.message);
              } else {
                console.log('Successfully deleted log');
                
                // Optimistically update UI by removing the deleted entry
                const updatedLogs = logs.filter(log => log.id !== logId);
                setLogs(updatedLogs);
                
                // Update user profile with the new current weight (most recent after deletion)
                if (updatedLogs.length > 0) {
                  const newCurrentWeight = Number(updatedLogs[0].weight);
                  setUserProfile(prev => ({
                    ...prev,
                    weight: newCurrentWeight
                  }));
                  
                  // Update cache
                  globalWeightCache.cachedData = {
                    logs: updatedLogs,
                    userProfile: { ...userProfile, weight: newCurrentWeight }
                  };
                  
                  // Also update MainDashboard cache
                  try {
                    const { getMainDashboardCache } = require('../utils/cacheManager');
                    const mainCache = getMainDashboardCache();
                    if (mainCache.cachedData) {
                      mainCache.cachedData.currentWeight = newCurrentWeight;
                      mainCache.lastFetchTime = Date.now();
                    }
                  } catch (err) {
                    console.log('Failed to update MainDashboard cache:', err);
                  }
                }
                
                globalWeightCache.lastFetchTime = Date.now();
              }
            } catch (err) {
              console.error('Delete exception:', err);
              Alert.alert("Error", "Failed to delete entry");
            }
          },
        },
      ]
    );
  }, [logs, userProfile]);

  // Fallback delete handler using user_id and date
  const handleDeleteLogByDate = useCallback(async (userId, date) => {
    console.log('handleDeleteLogByDate called with userId:', userId, 'date:', date);
    
    RNAlert.alert(
      "Delete Entry",
      "Are you sure you want to delete this weight entry?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              console.log('Attempting to delete log with userId and date:', userId, date);
              const { error } = await supabase
                .from("weight_logs")
                .delete()
                .eq("user_id", userId)
                .eq("date", date);
              if (error) {
                console.error('Delete error:', error);
                Alert.alert("Error", error.message);
              } else {
                console.log('Successfully deleted log by date');
                
                // Optimistically update UI by removing the deleted entry
                const updatedLogs = logs.filter(log => !(log.user_id === userId && log.date === date));
                setLogs(updatedLogs);
                
                // Update user profile with the new current weight (most recent after deletion)
                if (updatedLogs.length > 0) {
                  const newCurrentWeight = Number(updatedLogs[0].weight);
                  setUserProfile(prev => ({
                    ...prev,
                    weight: newCurrentWeight
                  }));
                  
                  // Update cache
                  globalWeightCache.cachedData = {
                    logs: updatedLogs,
                    userProfile: { ...userProfile, weight: newCurrentWeight }
                  };
                  
                  // Also update MainDashboard cache
                  try {
                    const { getMainDashboardCache } = require('../utils/cacheManager');
                    const mainCache = getMainDashboardCache();
                    if (mainCache.cachedData) {
                      mainCache.cachedData.currentWeight = newCurrentWeight;
                      mainCache.lastFetchTime = Date.now();
                    }
                  } catch (err) {
                    console.log('Failed to update MainDashboard cache:', err);
                  }
                }
                
                globalWeightCache.lastFetchTime = Date.now();
              }
            } catch (err) {
              console.error('Delete exception:', err);
              Alert.alert("Error", "Failed to delete entry");
            }
          },
        },
      ]
    );
  }, [logs, userProfile]);

  // Memoized navigation handler to prevent multiple modal opens
  const navigateToAddWeight = useCallback(() => {
    // Prevent navigation if currently fetching or if already navigating
    if (!globalWeightCache.isFetching) {
      navigation.navigate("AddWeightScreen");
    }
  }, [navigation]);

  // Memoized navigation to main dashboard
  const navigateToMainDashboard = useCallback(() => {
    if (!globalWeightCache.isFetching) {
      navigation.navigate('MainDashboard');
    }
  }, [navigation]);

  // Memoized header component
  const renderHeader = useMemo(() => {
    try {
      const safeWeightData = weightData || { weightUnit: "kg", currentWeight: 0, weeklyChange: 0 };
      const safeChartData = chartData || {
        data: { labels: [''], datasets: [{ data: [0] }] },
        config: {},
        screenWidth: 300
      };
      const safeWeeklyChange = Number(safeWeightData.weeklyChange) || 0;
      const safeCurrentWeight = Number(safeWeightData.currentWeight) || 0;
      const chartWidth = Math.max((safeChartData.screenWidth || 300) - 64, 200);
      
      return (
        <>
          <Text style={styles.subheader}>
            See how far you&apos;ve come, at your pace.
          </Text>
          {/* Today's Weight Card */}
          <View style={styles.todaysWeightCard}>
            <Text style={styles.todaysWeightLabel}>Current Weight</Text>
            <View style={styles.weightDisplay}>
              <Text style={styles.weightValue}>
                {safeCurrentWeight > 0 ? safeCurrentWeight.toFixed(0) : "--"}
              </Text>
              <Text style={styles.weightUnit}>{safeWeightData.weightUnit || "kg"}</Text>
            </View>
            <Text
              style={[
                styles.weightChange,
                { color: safeWeeklyChange < 0 ? ACCENT_GREEN : ACCENT_RED },
              ]}
            >
              {safeWeeklyChange !== 0 && !isNaN(safeWeeklyChange) ? (
                <>
                  {safeWeeklyChange < 0 ? "-" : "+"}
                  {Math.abs(safeWeeklyChange).toFixed(1)} {safeWeightData.weightUnit || "kg"} since last week
                </>
              ) : (
                "No change recorded"
              )}
            </Text>
          </View>

          {/* Progress Chart */}
          <View style={styles.chartCard}>
            <View style={styles.chartHeader}>
              <Text style={styles.chartTitle}>Progress</Text>
              <View style={styles.chartFilter}>
                <Text style={styles.chartFilterText}>Last 30 Days</Text>
                <Ionicons name="chevron-down" size={16} color="#7B61FF" />
              </View>
            </View>
            <View>
              {safeChartData.data && safeChartData.data.datasets && safeChartData.data.datasets[0] ? (
                <LineChart
                  data={safeChartData.data}
                  width={chartWidth}
                  height={220}
                  yAxisSuffix={` ${safeWeightData.weightUnit || "kg"}`}
                  chartConfig={safeChartData.config || {}}
                  bezier
                  withInnerLines={false}
                  withOuterLines={true}
                  fromZero={true}
                  segments={5}
                  style={{ 
                    alignSelf: 'center', 
                    borderRadius: 16, 
                    shadowColor: '#000', 
                    shadowOffset: { width: 0, height: 2 }, 
                    shadowOpacity: 0.1, 
                    shadowRadius: 4, 
                    elevation: 3 
                  }}
                />
              ) : (
                <View style={{ height: 220, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: GRAY }}>No chart data available</Text>
                </View>
              )}
            </View>
        
        {/* Add New Weight Button */}
        <TouchableOpacity
          style={styles.addBtnFixed}
          onPress={navigateToAddWeight}
        >
          <Ionicons name="add" size={24} color={WHITE} />
          <Text style={styles.addBtnText}>Add New Weight</Text>
        </TouchableOpacity>
        
        {/* Weight Trend Analysis Section */}
        {trendAnalysis && (
          <View style={styles.trendAnalysisCard}>
            <Text style={styles.trendAnalysisTitle}>📊 Trend Analysis</Text>
            <View style={styles.trendStats}>
              <View style={styles.trendStat}>
                <Text style={styles.trendStatLabel}>Weekly Change</Text>
                <Text style={[
                  styles.trendStatValue,
                  { color: trendAnalysis.weeklyChange > 0 ? ACCENT_RED : ACCENT_GREEN }
                ]}>
                  {trendAnalysis.weeklyChange !== undefined && !isNaN(trendAnalysis.weeklyChange) 
                    ? `${trendAnalysis.weeklyChange > 0 ? '+' : ''}${trendAnalysis.weeklyChange.toFixed(1)}kg`
                    : '0.0kg'}
                </Text>
              </View>
              <View style={styles.trendStat}>
                <Text style={styles.trendStatLabel}>Trend</Text>
                <Text style={styles.trendStatValue}>
                  {trendAnalysis.trend === 'increasing' ? '📈 Increasing' : 
                   trendAnalysis.trend === 'decreasing' ? '📉 Decreasing' : '⚖️ Stable'}
                </Text>
              </View>
              <View style={styles.trendStat}>
                <Text style={styles.trendStatLabel}>Confidence</Text>
                <Text style={styles.trendStatValue}>
                  {trendAnalysis.confidence === 'high' ? '🟢 High' : 
                   trendAnalysis.confidence === 'medium' ? '🟡 Medium' : '🔴 Low'}
                </Text>
              </View>
            </View>
            <Text style={styles.trendAnalysisMessage}>{trendAnalysis.message}</Text>
          </View>
        )}
        
        {/* Weight Insights Section */}
        {weightInsights.length > 0 && (
          <View style={styles.insightsCard}>
            <Text style={styles.insightsTitle}>💡 Personalized Insights</Text>
            {weightInsights.map((insight, index) => (
              <View key={index} style={[
                styles.insightItem,
                insight.priority === 'high' && styles.highPriorityInsight
              ]}>
                <Text style={styles.insightIcon}>{insight.icon}</Text>
                <View style={styles.insightContent}>
                  <Text style={styles.insightTitle}>{insight.title}</Text>
                  <Text style={styles.insightMessage}>{insight.message}</Text>
                  <Text style={styles.insightAction}>{insight.action}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </>
      );
    } catch (error) {
      console.error('Error rendering header:', error);
      return (
        <View style={styles.todaysWeightCard}>
          <Text style={styles.todaysWeightLabel}>Loading...</Text>
        </View>
      );
    }
  }, [weightData, chartData, trendAnalysis, weightInsights, navigateToAddWeight]);

  // Memoized render item for FlatList
  const renderLogItem = useCallback(({ item, index }) => {
    try {
      if (!item) {
        return null;
      }
      
      return (
        <WeightLogItem 
          item={item} 
          index={index} 
          logs={Array.isArray(logs) ? logs : []} 
          weightData={weightData || { weightUnit: "kg" }} 
          handleDeleteLog={handleDeleteLog}
          handleDeleteLogByDate={handleDeleteLogByDate}
        />
      );
    } catch (_error) {
      return null;
    }
  }, [weightData, handleDeleteLog, handleDeleteLogByDate, logs]);

  // Memoized key extractor
  const keyExtractor = useCallback((item, index) => {
    try {
      if (!item) return `item-${index}`;
      return item.id?.toString() || item.date?.toString() || `fallback-${index}`;
    } catch (_error) {
      return `error-${index}`;
    }
  }, []);

  // Memoized empty component
  const ListEmptyComponent = useMemo(() => (
    <Text style={styles.emptyHistory}>No weight entries yet.</Text>
  ), []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Custom Header */}
      <View style={styles.customHeader}>
        <TouchableOpacity 
          style={styles.backButton}
          onPress={navigateToMainDashboard}
        >
          <Ionicons name="chevron-back" size={24} color="#1F2937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Weight Tracker</Text>
        <View style={styles.headerSpacer} />
      </View>
      
      <FlatList
        data={Array.isArray(logs) ? logs : []}
        keyExtractor={keyExtractor}
        renderItem={renderLogItem}
        ListEmptyComponent={ListEmptyComponent}
        ListHeaderComponent={renderHeader}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: (insets?.bottom || 0) >= 20 ? (100 + (insets.bottom || 0)) : 100 }]}
        removeClippedSubviews={true} // Performance optimization
        maxToRenderPerBatch={10} // Performance optimization
        windowSize={10} // Performance optimization
        initialNumToRender={5}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: WHITE },
  customHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: WHITE,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: {
    padding: 8,
    marginRight: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#1F2937',
    fontFamily: 'Lexend-Bold',
    flex: 1,
    textAlign: 'center',
  },
  headerSpacer: {
    width: 40, // Same width as back button to center the title
  },
  scrollContent: { padding: 20, paddingBottom: 100 },
  header: {
    fontSize: 28,
    fontWeight: "bold",
    color: PRIMARY,
    marginTop: 10,
    marginBottom: 2,
    fontFamily: "Lexend-Bold",
  },
  subheader: {
    fontSize: 16,
    color: GRAY,
    marginBottom: 18,
    fontFamily: "Manrope-Regular",
  },
  todaysWeightCard: {
    backgroundColor: WHITE,
    borderRadius: 20,
    padding: 20,
    marginBottom: 18,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  todaysWeightLabel: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1F2937",
    fontFamily: "Lexend-Bold",
  },
  weightDisplay: {
    flexDirection: "row",
    alignItems: "baseline",
  },
  weightValue: {
    fontSize: 48,
    fontWeight: "800",
    color: "#1F2937",
    fontFamily: "Lexend-Bold",
  },
  weightUnit: {
    fontSize: 20,
    fontWeight: "400",
    color: "#1F2937",
    marginLeft: 4,
    fontFamily: "Manrope-Regular",
  },
  weightChange: {
    fontSize: 16,
    color: ACCENT_GREEN,
    fontFamily: "Manrope-Regular",
  },
  historyHeader: {
    fontSize: 20,
    fontWeight: "bold",
    color: PRIMARY,
    marginBottom: 8,
    fontFamily: "Lexend-Bold",
  },
  historyItem: {
    backgroundColor: WHITE,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    borderWidth: 1,
    borderColor: "#F3F4F6",
  },
  historyItemContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  imagePlaceholder: {
    width: 60,
    height: 60,
    borderRadius: 12,
    backgroundColor: "#F9FAFB",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  historyImage: {
    width: 60,
    height: 60,
    borderRadius: 12,
  },
  weightDetails: {
    flex: 1,
    justifyContent: "center",
  },
  historyWeight: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1F2937",
    fontFamily: "Lexend-Bold",
    marginBottom: 4,
  },
  historyDate: {
    fontSize: 14,
    color: "#6B7280",
    fontFamily: "Manrope-Regular",
    marginBottom: 4,
  },
  historyNote: {
    fontSize: 14,
    color: "#374151",
    fontFamily: "Manrope-Regular",
  },
  weightChangeContainer: {
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: 60,
  },
  weightChangeText: {
    fontSize: 16,
    fontWeight: "700",
    fontFamily: "Lexend-Bold",
  },
  deleteButton: {
    padding: 4,
    borderRadius: 8,
    backgroundColor: "#F9FAFB",
  },
  emptyHistory: {
    color: GRAY,
    fontSize: 16,
    textAlign: "center",
    marginTop: 20,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PRIMARY,
    borderRadius: 32,
    paddingVertical: 18,
    marginHorizontal: 20,
    position: "absolute",
    left: 0,
    right: 0,
  },
  addBtnFixed: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: PRIMARY,
    borderRadius: 32,
    paddingVertical: 18,
    marginHorizontal: 12,
    marginTop: 20,
    marginBottom: 20,
  },
  addBtnText: {
    color: WHITE,
    fontFamily: "Lexend-Bold",
    fontSize: 20,
    marginLeft: 8,
  },
  chartCard: {
    backgroundColor: WHITE,
    borderRadius: 20,
    padding: 16,
    marginBottom: 18,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  chartHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  chartTitle: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#1F2937",
    fontFamily: "Lexend-Bold",
  },
  chartFilter: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F3E8FF",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chartFilterText: {
    fontSize: 14,
    color: "#7B61FF",
    fontFamily: "Manrope-Regular",
    marginRight: 4,
  },
  
  // Trend Analysis Styles
  trendAnalysisCard: {
    backgroundColor: WHITE,
    borderRadius: 20,
    padding: 20,
    marginVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  trendAnalysisTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#11181C',
    marginBottom: 16,
  },
  trendStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  trendStat: {
    alignItems: 'center',
    flex: 1,
  },
  trendStatLabel: {
    fontSize: 12,
    color: '#6B7280',
    marginBottom: 4,
    fontWeight: '500',
  },
  trendStatValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#11181C',
  },
  trendAnalysisMessage: {
    fontSize: 14,
    color: '#6B7280',
    textAlign: 'center',
    fontStyle: 'italic',
  },
  
  // Weight Insights Styles
  insightsCard: {
    backgroundColor: WHITE,
    borderRadius: 20,
    padding: 20,
    marginVertical: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  insightsTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#11181C',
    marginBottom: 16,
  },
  insightItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#F8F9FF',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E0E7FF',
  },
  highPriorityInsight: {
    backgroundColor: '#FEF3C7',
    borderColor: '#F59E0B',
  },
  insightIcon: {
    fontSize: 24,
    marginRight: 12,
    marginTop: 2,
  },
  insightContent: {
    flex: 1,
  },
  insightTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 4,
  },
  insightMessage: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 6,
    lineHeight: 20,
  },
  insightAction: {
    fontSize: 13,
    color: '#7B61FF',
    fontWeight: '500',
    fontStyle: 'italic',
  },
});

// Export cache for external access
export { globalWeightCache };

// Wrap with React.memo to prevent unnecessary re-renders (Instagram pattern)
export default React.memo(WeightTrackerScreen, (prevProps, nextProps) => {
  return prevProps.navigation === nextProps.navigation;
});
